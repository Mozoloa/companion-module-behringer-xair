/* eslint-disable no-useless-escape */
import OSC from 'osc'
import { combineRgb, Regex, TCPHelper } from '@companion-module/base'
import { runEntrypoint, InstanceBase, InstanceStatus } from '@companion-module/base'
import { UpgradeScripts } from './upgrades.js'
import { buildConstants } from './constants.js'
import { buildStripDefs } from './buildStripDefs.js'
import { buildSoloDefs } from './buildSoloDefs.js'
import { buildStaticActions } from './actions.js'
import { buildSnapshotDefs } from './buildSnapshotDefs.js'

import { ICON_SOLO } from './icons.js'
import { pad0 } from './helpers.js'

class BAirInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

		this.snapshot = []

		this.currentSnapshot = 0

		this.myMixer = {
			name: '',
			model: '',
			modelNum: 0,
			fwVersion: '',
		}

		// mixer state
		this.xStat = {}
		// level/fader value store
		this.tempStore = {}
		// stat id from mixer address
		this.fbToStat = {}

		this.soloOffset = {}
		this.actionDefs = {}
		this.muteFeedbacks = {}
		this.colorFeedbacks = {}
		this.variableDefs = []
		this.fLevels = {}
		this.fLevels[1024] = []
		this.fLevels[161] = []
		this.blinkingFB = {}
		this.crossFades = {}
		this.PollCount = 100
		this.PollTimeout = 100
		this.needStats = true
		this.blinkOn = false

		buildConstants(this)
	}

	async init(config) {
		this.config = config

		// cross-fade steps per second
		this.fadeResolution = 20

		buildStripDefs(this)
		buildSoloDefs(this)
		buildStaticActions(this)
		buildSnapshotDefs(this)
		this.setActionDefinitions(this.actionDefs)
		this.buildStaticFeedbacks(this)
		this.buildStaticVariables()
		this.buildPresets()
		this.init_osc()
		this.log('debug', Object.keys(this.xStat).length + ' status addresses')
	}

	async updateConfig(config) {
		self.init(config)
	}

	// When module gets deleted
	async destroy() {
		if (this.heartbeat) {
			clearInterval(this.heartbeat)
			delete this.heartbeat
		}
		if (this.blinker) {
			clearInterval(this.blinker)
			delete this.blinker
		}
		if (this.fader) {
			clearInterval(this.fader)
			delete this.fader
		}
		if (this.oscPort) {
			this.oscPort.close()
		}
	}

	/**
	 * heartbeat to request updates, subscription expires every 10 seconds
	 */
	pulse() {
		this.sendOSC('/xremote', [])
		// any leftover status needed?
		if (this.needStats) {
			this.pollStats()
		}
	}

	/**
	 * feedback blinker (1 sec interval)
	 */
	blink() {
		// toggle 'blinker'
		this.blinkOn = !this.blinkOn
		this.checkFeedbacks(...Object.keys(this.blinkingFB))
	}

	/**
	 * timed fades
	 */
	doFades() {
		let arg = { type: 'f' }
		let fadeDone = []

		for (let f in this.crossFades) {
			let c = this.crossFades[f]
			c.atStep++
			let atStep = c.atStep
			let newVal = c.startVal + c.delta * atStep

			arg.value = Math.sign(c.delta) > 0 ? Math.min(c.finalVal, newVal) : Math.max(c.finalVal, newVal)

			this.sendOSC(f, arg)

			if (atStep > c.steps) {
				fadeDone.push(f)
			}
		}

		// delete completed fades
		for (let f of fadeDone) {
			delete this.crossFades[f]
		}
	}

	buildPresets() {
		const presets = {}

		presets['chan_fb'] = {
			type: 'button',
			category: 'Channel',
			name: 'Channel 1 Label\nIncludes Label, Color, Mute toggle, Mute feedback, Solo feedback',
			style: {
				text: '$(xair:l_ch1)',
				size: '18',
				color: combineRgb(255, 255, 255),
				bgcolor: 0,
			},
			steps: [
				{
					down: [
						{
							actionId: 'mute',
							options: {
								type: '/ch/',
								num: 1,
								mute: 2,
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'c_ch',
					options: {
						theChannel: 1,
					},
				},
				{
					feedbackId: 'ch',
					options: {
						theChannel: 1,
						state: 1,
					},
					style: {
						color: 16777215,
						bgcolor: combineRgb(128, 0, 0),
					},
				},
				{
					feedbackId: 'solosw_ch',
					options: {
						theChannel: 1,
						state: '1',
					},
					style: {
						color: combineRgb(255, 255, 255),
						bgcolor: combineRgb(0, 0, 0),
						png64: ICON_SOLO,
					}
				},
			],
		}

		presets['chan_lvl'] = {
			type: 'button',
			category: 'Channel',
			name: 'Channel 1 Level\nIncludes Fader dB, Color, Solo toggle, Solo feedback',
			style: {
				text: '$(xair:f_ch1_d)',
				size: '18',
				color: combineRgb(255, 255, 255),
				bgcolor: 0,
			},
			steps: [
				{
					down: [
						{
							actionId: 'solosw_ch',
							options: {
								num: 1,
								solo: 2,
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'c_ch',
					options: {
						theChannel: 1,
					},
				},
				{
					feedbackId: 'solosw_ch',
					options: {
						theChannel: 1,
						state: 1,
					},
					style: {
						color: combineRgb(255, 255, 255),
						bgcolor: combineRgb(0, 0, 0),
						png64: ICON_SOLO,
					},
				},
			],
		}
		presets['rude'] = {
			type: 'button',
			category: 'Status',
			name: 'Rude Solo Button\nBlinks if any solo is on\nPush to clear all solos',
			style: {
				text: 'All Solo Clear',
				size: '18',
				color: combineRgb(255, 255, 255),
				bgcolor: 0,
			},
			steps: [
				{
					down: [
						{
							actionId: 'clearsolo',
							options: {},
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'clearsolo',
					options: {
						blink: 1,
						fg: combineRgb(255,255,255),
						bg: combineRgb(255,0,0)
					},
				},
			],
		}

		this.setPresetDefinitions(presets)
	}

	pollStats() {
		let stillNeed = false
		let counter = 0
		let timeNow = Date.now()
		let timeOut = timeNow - this.PollTimeout

		for (const id in this.xStat) {
			if (!this.xStat[id].valid) {
				stillNeed = true
				if (this.xStat[id].polled < timeOut) {
					this.sendOSC(id)
					this.log('debug', 'sending ' + id)
					this.xStat[id].polled = timeNow
					counter++
					// only allow 'PollCount' queries during one cycle
					if (counter > this.PollCount) {
						break
					}
				}
			}
		}

		if (!stillNeed) {
			this.updateStatus(InstanceStatus.Ok, 'Console status loaded')
			const c = Object.keys(this.xStat).length
			const d = (c / ((timeNow - this.timeStart) / 1000)).toFixed(1)
			this.log('info', `Status Sync complete (${c}@${d})`)
		}
		this.needStats = stillNeed
	}

	firstPoll() {
		this.sendOSC('/xinfo', [])
		this.sendOSC('/-snap/index', [])
		this.sendOSC('/-snap/name', [])
		this.timeStart = Date.now()
		this.pollStats()
		this.pulse()
	}

	stepsToFader(i, steps) {
		let res = i / (steps - 1)

		return Math.floor(res * 10000) / 10000
	}

	faderToDB(f, steps, rp) {
		// “f” represents OSC float data. f: [0.0, 1.0]
		// “d” represents the dB float data. d:[-oo, +10]
		// if "rp" (Relative percent) is true, the function returns a loudness perceptual (base 10/33.22) change in % compared to unity (0dB)
		let d = 0

		if (f >= 0.5) {
			d = f * 40.0 - 30.0 // max dB value: +10.
		} else if (f >= 0.25) {
			d = f * 80.0 - 50.0
		} else if (f >= 0.0625) {
			d = f * 160.0 - 70.0
		} else if (f >= 0.0) {
			d = f * 480.0 - 90.0 // min dB value: -90 or -oo
		}
		return f == 0
			? rp
				? '0'
				: '-oo'
			: (rp ? '' : d > 0 ? '+' : '') + (rp ? 100 * 10 ** (d / 33.22) : Math.round(d * 1023.5) / 1024).toFixed(1)
	}

	init_osc() {
		let self = this

		if (this.oscPort) {
			this.oscPort.close()
		}
		if (this.config.host) {
			this.oscPort = new OSC.UDPPort({
				localAddress: '0.0.0.0',
				localPort: 0,
				remoteAddress: this.config.host,
				remotePort: 10024,
				metadata: true,
			})

			// listen for incoming messages
			this.oscPort.on('message', function (message, timeTag, info) {
				const args = message.args
				const node = message.address
				const leaf = node.split('/').pop()

				self.log('debug', `received ${node} from ${info.address}`)
				if (self.xStat[node] !== undefined) {
					let v = args[0].value
					switch (leaf) {
						case 'on':
						case 'lr':
							self.xStat[node].isOn = v == 1
							self.checkFeedbacks(self.xStat[node].fbID)
							break
						case '1':
						case '2':
						case '3':
						case '4': // '/config/mute/#'
							self.xStat[node].isOn = v == 1
							self.checkFeedbacks(self.xStat[node].fbID)
							break
						case 'fader':
						case 'level':
							v = Math.floor(v * 10000) / 10000
							self.xStat[node][leaf] = v
							self.setVariableValues({
								[self.xStat[node].varID + '_p']: Math.round(v * 100),
								[self.xStat[node].varID + '_d']: self.faderToDB(v, 1024, false),
								[self.xStat[node].varID + '_rp']: Math.round(self.faderToDB(v, 1024, true)),
							})
							self.xStat[node].idx = self.fLevels[self.xStat[node].fSteps].findIndex((i) => i >= v)
							break
						case 'name':
							// no name, use behringer default
							v = v == '' ? self.xStat[node].defaultName : v
							self.xStat[node].name = v
							self.setVariableValues({ [self.xStat[node].fbID]: v })
							break
						case 'color':
							self.xStat[node].color = v
							self.checkFeedbacks(self.xStat[node].fbID)
							break
						case 'mono':
						case 'dim':
						case 'mute': // '/config/solo/'
							self.xStat[node].isOn = v
							self.checkFeedbacks(self.xStat[node].fbID)
							break
						default:
							if (node.match(/\/solo/)) {
								self.xStat[node].isOn = v
								self.checkFeedbacks(self.xStat[node].fbID)
							}
					}
					self.xStat[node].valid = true
					if (self.needStats) {
						self.pollStats()
					}
					// log('debug',message);
				} else if (node.match(/^\/xinfo$/)) {
					self.myMixer.name = args[1].value
					self.myMixer.model = args[2].value
					self.myMixer.modelNum = parseInt(args[2].value)
					self.myMixer.fw = args[3].value
					self.setVariableValues({
						'm_name': self.myMixer.name,
						'm_model': self.myMixer.model,
						'm_modelNum': self.myMixer.modelNum,
						'm_fw': self.myMixer.fw,
					})
				} else if (node.match(/^\/\-snap\/name$/)) {
					const n = args[0].value
					self.xStat[self.snapshot[self.currentSnapshot]].name = n
					self.setVariableValues({ 's_name': n })
				} else if (node.match(/^\/\-snap\/index$/)) {
					const s = parseInt(args[0].value)
					const n = self.xStat[self.snapshot[s]].name
					self.currentSnapshot = s
					self.setVariableValues({
						's_index': s,
						's_name': n,
						['s_name_' + pad0(s)]: n,
					})
					self.checkFeedbacks('snap_color')
					self.sendOSC('/-snap/' + pad0(s) + '/name', [])
				}
				// else {
				// 	log('debug',message.address, args);
				// }
			})

			this.oscPort.on('ready', function () {
				self.updateStatus(InstanceStatus.Connecting, 'Loading console status')
				self.log('info', 'Sync started')
				self.firstPoll()
				self.heartbeat = setInterval(function () {
					self.pulse()
				}, 9500) // just before 10 sec expiration
				self.blinker = setInterval(function () {
					self.blink()
				}, 1000)
				self.fader = setInterval(function () {
					self.doFades()
				}, 1000 / self.fadeResolution)
			})

			this.oscPort.on('close', function () {
				if (self.heartbeat) {
					clearInterval(self.heartbeat)
					delete self.heartbeat
				}
				if (self.blinker) {
					clearInterval(self.blinker)
					delete self.blinker
				}
				if (self.fader) {
					clearInterval(self.fader)
					delete self.fader
				}
			})

			this.oscPort.on('error', function (err) {
				self.log('error', 'Error: ' + err.message)
				self.updateStatus(InstanceStatus.UnknownError, err.message)
				if (self.heartbeat) {
					clearInterval(self.heartbeat)
					delete self.heartbeat
				}
				if (self.blinker) {
					clearInterval(self.blinker)
					delete self.blinker
				}
				if (self.fader) {
					clearInterval(self.fader)
					delete self.fader
				}
			})

			this.oscPort.open()
		}
	}

	// define static instance variables
	buildStaticVariables() {
		const variables = [
			{
				name: 'XAir Mixer Name',
				variableId: 'm_name',
			},
			{
				name: 'XAir Mixer Model',
				variableId: 'm_model',
			},
			{
				name: 'XAir Mixer Firmware',
				variableId: 'm_fw',
			},
			{
				name: 'Current Snapshot Name',
				variableId: 's_name',
			},
			{
				name: 'Current Snapshot Index',
				variableId: 's_index',
			},
		]
		variables.push.apply(variables, this.variableDefs)

		this.setVariableDefinitions(variables)
	}

	// define instance feedbacks
	buildStaticFeedbacks(self) {
		const feedbacks = {
			snap_color: {
				type: 'advanced',
				label: 'Color on Current Snapshot',
				description: 'Set Button colors when this Snapshot is loaded',
				options: [
					{
						type: 'colorpicker',
						label: 'Foreground color',
						id: 'fg',
						default: '16777215',
					},
					{
						type: 'colorpicker',
						label: 'Background color',
						id: 'bg',
						default: combineRgb(0, 128, 0),
					},
					{
						type: 'number',
						label: 'Snapshot to match',
						id: 'theSnap',
						default: 1,
						min: 1,
						max: 64,
						range: false,
						required: true,
					},
				],
				callback: function (feedback, context) {
					if (feedback.options.theSnap == self.currentSnapshot) {
						return { color: feedback.options.fg, bgcolor: feedback.options.bg }
					}
				},
			},
		}
		Object.assign(feedbacks, self.muteFeedbacks)
		Object.assign(feedbacks, self.colorFeedbacks)
		this.setFeedbackDefinitions(feedbacks)
	}

	// Return config fields for web config
	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				tooltip: 'The IP of the MR / XR console',
				width: 6,
				regex: Regex.IP,
			},
		]
	}

	async sendOSC(node, arg) {
		arg = arg ?? []

		if (this.oscPort) {
			this.oscPort.send({
				address: node,
				args: arg,
			})
		}
	}
}

runEntrypoint(BAirInstance, UpgradeScripts)
