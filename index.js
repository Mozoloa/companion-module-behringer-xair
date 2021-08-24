
var instance_skel = require('../../instance_skel');
var OSC = require('osc');
var defStrip = require('./defStrip.json');
var defSolo = require('./defSolo.json');
var debug;
var log;

function instance(system, id, config) {
	var self = this;
	var po = 0;

	self.snapshot = [];

	self.currentSnapshot = 0;

	self.myMixer = {
		name: '',
		model: '',
		fwVersion: ''
	};

	// mixer state
	self.xStat = {};
	// level/fader value store
	self.tempStore = {};
	// stat id from mixer address
	self.fbToStat = {};

	self.soloOffset = {};
	self.actionDefs = {};
	self.muteFeedbacks = {};
	self.colorFeedbacks = {};
	self.variableDefs = [];
	self.fLevels = {};
	self.fLevels[1024] = [];
	self.fLevels[161] = [];
	self.blinkingFB = {};
	self.crossFades = {};
	self.PollCount = 9;
	self.PollTimeout = 400;
	self.needStats = true;

	self.setConstants();

	// super-constructor
	instance_skel.apply(this, arguments);

	// each instance needs a separate local port
	id.split('').forEach(function (c) {
		po += c.charCodeAt(0);
	});
	self.port_offset = po;

	self.debug = debug;
	self.log = log;

	return self;
}

// instance.DEVELOPER_forceStartupUpgradeScript = 1;

instance.GetUpgradeScripts = function() {

	// grab these values for later
	var icon = this.prototype.ICON_SOLO;

	return [
		function(context, config, actions, feedbacks) {
			var changed = false;

			for (var k in actions) {
				var action = actions[k];

				if (['mute','mMute','usbMute'].includes(action.action)) {
					if (action.options.mute === null) {
						action.options.mute = '0';
						changed = true;
					}
				}
				if ('mute_grp' == action.action) {
					if (action.options.mute === null) {
						action.options.mute = '1';
						changed = true;
					}
				}
			}
			return changed;
		},

		instance_skel.CreateConvertToBooleanFeedbackUpgradeScript({
			solo_mute: true,
			solo_mono: true,
			solo_dim: true,
			rtn: true,
			lr: true,
			fxsend: true,
			dca: true,
			bus: true,
			ch: true,
			solosw_aux: true,
			solosw_bus: true,
			solosw_ch: true,
			solosw_dca: true,
			solosw_fxr: true,
			solosw_fxs: true,
			solosw_lr: true,
			'rtn/aux': true,
			'config/mute': true
		}),

		function(context, config, actions, feedbacks) {
			var changed = false;

			for (var k in feedbacks) {
				var fb = feedbacks[k];
				if (fb.type.match(/^solosw_/) && (Object.keys(fb.style).length == 0)) {
					fb.style = {
						color: context.rgb(255, 255, 255),
						bgcolor: context.rgb(0, 0, 0),
						png64: icon
					};
					changed = true;
				}
			}
			return changed;
		}
	]
}

function bx_pad2(num,len) {
	len = len || 2;
	var s = "00" + num;
	return s.substr(s.length - len);
}

function bx_unslash(s) {
	return s.split('/').join('_');
}


instance.prototype.ICON_SOLO =
	'iVBORw0KGgoAAAANSUhEUgAAAEgAAAA6CAYAAAATBx+NAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAALEwAACxMBAJqcGAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAUcSURBVHic7ZpLaFxVGIC//96ZTNKkqSnGN+JzUS3oyqi1ogstqKAIuhIVFEUUtOBGhC5UxI2FgigYKLqpFRdV8FFsN1rFbtoGWwyl1lStsa+0NjNJzsy5M7+LuXdyZzKT00zSJpTzwYU573O/+c859w4jeQ0UTytMsNgzWOp4QQ4y6YQijyrl4cWazFIgIHgHeDJJ1wkKKf/dLRy64LNaQuSV8XTaLzEHXpADL8iBF+TAC3LgBTnwghx4QQ68IAdekAMvyIEX5MALcuAFOfCCHHhBDrwgB16QAy/IgRfkwAty4AU58IIceEEOvCAHXpADL8iBF+TAC3LgBTnwghx4QQ68IAcNf8GjfzEmoUpfucgalJUIY2VhpKODYRHa+gduZPhY4XpVjnd08dS8JpfXQJNrXIORgnL5vDqcIyXDC9ZQsAZtuE5Ehofa6dMafrUGLRlG5to2r8FgyslUbYmJgsB1SrBzXLm0nYnNldIkAwIfAd1NivsryhUXYh6zURPUYStINaBXC8GOs8rK8z54wLOpOWxEuVfgEYQ3YYn8mTQJpzgkdaJcC699/yl953Nsa9gRL6eTjWWqBKqsaMjrskXesIY91jBqDfut4T1tmGerJaZKr53i7bh81BqGbJENqtMR3LjE6gTNlBT+clJZvtBiUjeyLR43iqZ4WpVsq7qqdFjDj032KrWG31S5JNXvDEGqLLeGoabti+xWpbOZoBnHvABZWyGoKKB3dhJuP6H0LKya2mB74k+hCp9GJf61hi+iIk+okktXjYq8CqyN5/g7yrvAUFy8qlzkrdmGiopsAG6Lkwfi9gcBUAaiEq83bZjXQAupCEpfE2VJImnXMW26kc4LVfoiw+EWUbHfGG5I6iZRYQ1lY7gxbr/CGsbj/NOq1f2sWQRZw7G43pSOVw8hneQaa7Bx/sHYx+wRlKbDKmE1ku7pRrYlYbhQiHAmLHEHsAk401C8OqzmEy+9W+P84c5ODsftzwI/xfl9xnBts3F0giuh9viyW3o5BSDLOIrWovBmbRIEVUGzPI5la5LkgQLyZWPozxfpZSzbyWuZHJeh3CfC5lTxOlVCoIfp024s3V6lerMAYVi/qScUQ3pTyVN1hVLrT5isqwec46tG1iphWQFZV0C2zraZtosIUbaLHzI5ngN2JUMzQT8wwfTXWHdiSeoEq1TIN+s7V6GQStafzOkTcNnM9uf8LpaNapIeiyVlnI0cWMPGkuFlVTpq863KTx5UK3QzLkKJZEOFW3SSq+O6XcCaOH88l+PPpgN1MZqKlAGNT2bN049wO4DAiEidSGCOL6spSY8XCLbMV5IqVwl8EBX5xxq+iopsjooMAaviKvtEmKR6B1vivDAK+LpkWB8V+Y44IgQ+F6HcbBwRVJTP4mRPVGJ7ybA+yvAtVL8c1Vr/9eQ10EKl+SnW6pqMJHl3+yQ5OdqhNMXWWcYpR4aHUzKXWcPeZnVLhiNamH6HbPEctDIyHGox1oEkquZ0irUiiSSBZyYIBtuVlLW8ovAS8L3AH0CJ6mm2A+XBTCffJHVFmMzkuB94X+EIYIFRgcFsmbukh+O1urAb2Inyc6r96dByt8CHwFHAKvwFbMrkWCvSfP+SvAYqCrlSZc43GGWEKBSAwR4qL7b788RSIq/BIPB8nDTzEgQQhUKUEUCHQfYu1EQXkQHgpvjztKDqq0V7VAJBZUEmt9QwGQAVKIcX5x3Ol4xUH8LaRqt9CNVN86JCYep/T6xGm2u0hEsAAAAASUVORK5CYII=';


instance.prototype.updateConfig = function(config) {
	var self = this;

	self.config = config;
	self.init();
};

instance.prototype.init = function() {
	var self = this;

	debug = self.debug;
	log = self.log;

	// cross-fade steps per second
	self.fadeResolution = 20;

	self.init_strips();
	self.init_solos();
	self.init_actions();
	self.init_snaps();
	self.init_variables();
	self.init_feedbacks();
	self.init_presets();
	self.init_osc();
	debug(Object.keys(self.xStat).length + " status addresses loaded");
};

/**
 * heartbeat to request updates, subscription expires every 10 seconds
 */
instance.prototype.pulse = function () {
	var self = this;
	self.sendOSC("/xremote", []);
	// any leftover status needed?
	if (self.needStats) {
		self.pollStats();
	}
};

/**
 * blink feedbacks
 */
instance.prototype.blink = function () {
	var self = this;
	for (var f in self.blinkingFB) {
		self.checkFeedbacks(f);
	}
};

/**
 * timed fades
 */
instance.prototype.doFades = function () {
	var self = this;
	var arg = { type: 'f' };
	var fadeDone = [];

	for (var f in self.crossFades) {
		var c = self.crossFades[f];
		c.atStep++;
		var atStep = c.atStep;
		var newVal = c.startVal + (c.delta * atStep);

		arg.value = (Math.sign(c.delta)>0) ? Math.min(c.finalVal, newVal) : Math.max(c.finalVal, newVal);

		self.sendOSC(f, arg);

		if (atStep > c.steps) {
			fadeDone.push(f);
		}
	}

	// delete completed fades
	for (f in fadeDone) {
		delete self.crossFades[fadeDone[f]];
	}
};

instance.prototype.init_presets = function () {
	var self = this;

	var presets = [
		{
			category: 'Channels',
			label: 'Channel 1 Label\nIncludes Label, Color, Mute toggle, Mute feedback, Solo feedback',
			bank: {
				style: 'png',
				text: '$(xair:l_ch1)',
				size: '18',
				color: self.rgb(255,255,255),
				bgcolor: 0
			},
			actions: [
				{
					action: 'mute',
					options: {
						type: '/ch/',
						num: 1,
						mute: 2
					}
				}
			],
			feedbacks: [
				{
					type: 'c_ch',
					options: {
						theChannel: 1
					}
				},
				{
					type: 'ch',
					options: {
						theChannel: 1
					},
					style: {
						color: 16777215,
						bgcolor: self.rgb(128,0,0)
					}
				},
				{
					type: 'solosw_ch',
					options: {
						theChannel: 1
					}
				}
			]
		},
		{
			category: 'Channels',
			label: 'Channel 1 Level\nIncludes Fader dB, Color, Solo toggle, Solo feedback',
			bank: {
				style: 'png',
				text: '$(xair:f_ch1_d)',
				size: '18',
				color: self.rgb(255,255,255),
				bgcolor: 0
			},
			actions: [
				{
					action: 'solosw_ch',
					options: {
						num: 1,
						solo: 2
					},
					style: {
						color: self.rgb(255, 255, 255),
						bgcolor: self.rgb(0, 0, 0),
						png64: self.ICON_SOLO
					}
				}
			],
			feedbacks: [
				{
					type: 'c_ch',
					options: {
						theChannel: 1
					}
				},
				{
					type: 'solosw_ch',
					options: {
						theChannel: 1
					}
				}
			]
		}
	];
	self.setPresetDefinitions(presets);
};


instance.prototype.init_snaps = function () {
	var self = this;
	var snapVars = [];

	for (var s = 1; s <= 64; s++) {
		var c = bx_pad2(s);
		var theID = `/-snap/${c}/name`;
		var fID = 's_name_' + c;
		self.fbToStat[fID] = theID;
		self.xStat[theID] = {
			name: '#' + c,
			defaultName: '#' + c,
			valid: false,
			fbID: fID,
			polled: 0
		};
		snapVars.push({
			label: "Snapshot " + c + " Name",
			name: fID
		});
		self.snapshot[s] = theID;
	}
	self.variableDefs.push(...snapVars);
}


instance.prototype.init_solos = function () {
	var self = this;

	var c, i, ch, cm, cMap, id, actID, soloID, cmd, pfx;

	var stat = {};
	var fbDescription;
	var soloActions = [];
	var soloFeedbacks = {};
	var soloVariables = [];
	var soloOffset = {};

	function soloLabel(d, min, max) {
		return d + (0 == max-min ? '' : " (" + min + "-" + max + ")");
	}


	var def = defSolo;

	for (id in def) {
		cmd = def[id];
		pfx = cmd.prefix;
		cMap = cmd.cmdMap;
		switch (cmd.id) {
		case "solosw":
			for (cm in cmd.cmdMap) {
				ch = cMap[cm];
				soloID = cmd.id + '_' + ch.actID;
				soloOffset[soloID] = ch.offset;
				soloActions[soloID] = {
					label: soloLabel("Solo " + ch.description, ch.min, ch.max),
					options: []
				};
				if (ch.min == ch.max) {
					c = bx_pad2(ch.min + ch.offset);
					self.fbToStat[soloID] = pfx + c;
					stat[pfx + c] = {
						fbID: soloID, //+ '_' + c,
						valid: false,
						polled: 0,
						hasOn: true,
						isOn: false
					};
				} else {
					for (i = ch.min; i<=ch.max; i++) {
						c = bx_pad2(i + ch.offset);
						self.fbToStat[soloID + i] = pfx + c;
						stat[pfx + c] = {
							fbID: soloID, // + '_' + c,
							valid: false,
							polled: 0,
							hasOn: true,
							isOn: false
						};
					}
					soloActions[soloID].options.push( {
						type: 'number',
						label: ch.description,
						id: 'num',
						default: 1,
						min: ch.min,
						max: ch.max,
						range: false,
						required: true
					});

				}
				soloActions[soloID].options.push( {
					type:	'dropdown',
					label:	'Solo',
					id:		'solo',
					default: '2',
					choices: [
						{id: '1', label: 'On'},
						{id: '0', label: 'Off'},
						{id: '2', label: 'Toggle'}
					]
				} );
				// solo feedback defs
				fbDescription = "Solo " + ch.description + " status";
				soloFeedbacks[soloID] = {
					type: 'boolean',
					label: 		 "Indicate " + fbDescription,
					description: "Indicate " + fbDescription + " on button",
					options: [
						{
							type:	'dropdown',
							label:	'State',
							id:		'state',
							default: '1',
							choices: [
								{id: '1', label: 'On'},
								{id: '0', label: 'Off'}
							]
						}
					],
					style: {
						color: self.rgb(255,255,255),
						bgcolor: self.rgb(0,0,0),
						png64: self.ICON_SOLO
					},
					callback: function(feedback, bank) {
						var theChannel = feedback.options.theChannel;
						var fbType = feedback.type;
						var stat;
						var state = feedback.options.state != '0';

						if (theChannel) {
							stat = self.xStat[self.fbToStat[fbType + theChannel]];
						} else if ( self.fbToStat[fbType] ) {
							stat = self.xStat[self.fbToStat[fbType]];
						}
						return stat.isOn == state;
					}
				};
				if (ch.min != ch.max) {
					soloFeedbacks[soloID].options.push( {
						type: 'number',
						label: ch.description + " number",
						id: 'theChannel',
						default: 1,
						min: ch.min,
						max: ch.max,
						range: false,
						required: true
					} );
				}
			}
			break;
		case "config":
			for (cm in cmd.cmdMap) {
				ch = cMap[cm];
				actID = 'solo_' + ch.actID;
				soloID = 'f_solo';
				c = pfx + ch.actID;
				stat[c] = {
					fbID: actID,
					varID: soloID,
					valid: false,
					polled: 0
				};
				self.fbToStat[actID] = c;
				if (ch.isFader) {
					fbDescription = "Solo " + ch.description;
					soloActions[actID] = {
						label: fbDescription + " Set",
						options: [ {
							type:	'dropdown',
							label:	'Fader Level',
							id:		'fad',
							default: '0.0',
							choices: self.FADER_VALUES
						} ]
					};
					soloActions[actID + '_a'] = {
						label: fbDescription + " Adjust",
						options: [{
							type:	 'number',
							tooltip:	 "Move fader +/- percent.\nFader Percent:\n0 = -oo, 75 = 0db, 100 = +10db",
							label:	 'Adjust',
							id:		 'ticks',
							min:	 -100,
							max:	 100,
							default: 1
						} ]
					};
					stat[c].fader = 0;
					stat[c].fSteps = 161;
					soloVariables.push({
						label: fbDescription + " dB",
						name: soloID + "_d"
					});
					soloVariables.push({
						label: fbDescription + " %",
						name: soloID + "_p"
					});
					soloVariables.push({
						label: fbDescription + " % Relative Loudness",
						name: soloID + "_rp"
					});
				} else {
					soloActions[actID] = {
						label: "Solo " + ch.description,
						options: []
					};
					soloActions[actID].options.push( {
						type:	'dropdown',
						label:	'Value',
						id:		'set',
						default: '2',
						choices: [
							{id: '1', label: 'On'},
							{id: '0', label: 'Off'},
							{id: '2', label: 'Toggle'}
						]
					} );
					stat[c].isOn = false;
					fbDescription = "Solo " + ch.description + " status";
					soloFeedbacks[actID] = {
						type: 'boolean',
						label: 		 "Indicate " + fbDescription,
						description: "Indicate " + fbDescription  + " on button",
						options: [
							{
								type:	'dropdown',
								label:	'State',
								id:		'state',
								default: '1',
								choices: [
									{id: '1', label: 'On'},
									{id: '0', label: 'Off'}
								]
							}
						],
						style: {
							color: self.rgb(255,255,255),
							bgcolor: self.rgb.apply(this, ch.bg)
						},
						callback: function(feedback, bank) {
							var fbType = feedback.type;
							var stat = self.xStat[self.fbToStat[fbType]];
							var state = feedback.options.state != '0';

							return stat.isOn == state;
						}
					};
				}
			}
			break;
		case 'action':
			for (cm in cmd.cmdMap) {
				ch = cMap[cm];
				actID = ch.actID;
				c = pfx + ch.actID;
				soloID = ch.statID;
				soloActions[actID] = {
					label: ch.description,
					description: ch.description,
					options: []
				};
				stat[soloID] = {
					fbID: actID,
					valid: false,
					polled: 0
				};
				self.fbToStat[actID] = soloID;
				if (!ch.hasFader) {
					stat[soloID].isOn = false;
					soloFeedbacks[actID] = {
						label: 		 ch.statDesc,
						description: "Color when " + ch.description,
						options: [
							{
								type: 	'checkbox',
								label: 	'Blink?',
								id:		'blink',
								default: 0
							},
							{
								type: 'colorpicker',
								label: 'Foreground color',
								id: 'fg',
								default: 0
							},
							{
								type: 'colorpicker',
								label: 'Background color',
								id: 'bg',
								default: self.rgb.apply(this,ch.bg)
							},
						],
						callback: function(feedback, bank) {
							var opt = feedback.options;
							var fbType = feedback.type;
							var stat = self.xStat[self.fbToStat[fbType]];

							if (stat.isOn) {
								if (opt.blink) {		// wants blink
									if (self.blinkingFB[stat.fbID]) {
										self.blinkingFB[stat.fbID] = false;
										// blink off
										return;
									} else {
										self.blinkingFB[stat.fbID] = true;
									}
								}
								return { color: opt.fg, bgcolor: opt.bg };
							} else if (self.blinkingFB[stat.fbID]) {
								delete self.blinkingFB[stat.fbID];
							}

						}
					};
				}
			}
			break;
		}
	}
	self.soloOffset = soloOffset;
	Object.assign(self.xStat, stat);
	Object.assign(self.variableDefs, soloVariables);
	Object.assign(self.actionDefs, soloActions);
	Object.assign(self.muteFeedbacks, soloFeedbacks);
};

instance.prototype.init_strips = function () {
	var self = this;

	var i, b, c, d, l;

	var muteSfx;
	var labelSfx;
	var fadeSfx;
	var defaultLabel;
	var chID;
	var theID;
	var muteID;
	var fadeID;
	var sendID;
	var fbID;
	var fpID;
	var fID;
	var bOrF;
	var sChan;
	var fbDescription;
	var hasOn;
	var hasMix;

	var stat = {};
	var muteActions = {};
	var procActions = {};
	var fadeActions = {};
	var storeActions = {};
	var sendActions = {};
	var muteFeedbacks = {};
	var procFeedbacks = {};
	var colorFeedbacks = {};
	var defVariables = [];
	var theStrip;
	var muteChoice;

	var busOpts = [];

	var defProc = {

		insert: {
			node: 'insert/on',
			desc: 'Insert FX',
		},
		gate: {
			node: 'gate/on',
			desc: 'Noise Gate',
		},
		eq: {
			node: 'eq/on',
			desc: 'EQ',
		},
		dyn: {
			node: 'dyn/on',
			desc: 'Compressor',
		},
		lr: {
			node: 'mix/lr',
			desc: 'Main Out'
		}
	}

	for (b=1; b<11; b++) {
		busOpts.push({
			label: (b<7 ? " Bus " + b : " FX " + (b - 6) ), id: b
		});
	}

	function capFirst(string) {
		return string.charAt(0).toUpperCase() + string.slice(1);
	}

	function sendLabel(d, min, max) {
		return d + (min == 0 ? '' : " " + min + "-" + max);
	}

	for (i in defStrip) {
		theStrip = defStrip[i];
		fbID = theStrip.id;
		chID = '/' + fbID;
		muteID = theStrip.muteID;
		fadeID = theStrip.fadeID;
		d = theStrip.digits;
		muteChoice = [ theStrip.hasOn ? '0' : '1', theStrip.hasOn ? '1' : '0', '2'];
		muteSfx = (theStrip.hasMix ? '/mix' : '') + (theStrip.hasOn ? '/on' : '');
		fadeSfx = (theStrip.hasMix ? '/mix' : '') + (theStrip.hasOn ? '/fader' : '');
		labelSfx = (theStrip.hasOn ? '/config' : '');
		defaultLabel = theStrip.label;
		if (defaultLabel != '' && d > 0 ){
			defaultLabel = defaultLabel + ' ';
		}

		console.log(`${chID}${muteSfx}, ${fadeSfx}`);

		// additional strip toggles

		for (var p of theStrip.proc) {
			var mID = theStrip.procPfx + p;
			if (0==d) {		// LR, rtn/aux (usb)
				procActions[mID] = {
					label: `${theStrip.description} ${defProc[p].desc} State`,
					options: [ {
						type:	'dropdown',
						label:	'Value',
						id:		'set',
						default: '2',
						choices: [
							{id: '1', label: 'On'},
							{id: '0', label: 'Off'},
							{id: '2', label: 'Toggle'}
						]
					} ],
				};
			} else {
				if (mID in procActions) {
					l = `${theStrip.description} ${theStrip.min}-${theStrip.max}`
					procActions[mID].options[0].choices.push({
						id:		`${chID}/`,
						label: 	l
					});
					procActions[mID].options[1].label += `, ${theStrip.description}`;
				} else {
					procActions[mID] = {
						label: defProc[p].desc + ' State',
						options: [
							{
								type:	'dropdown',
								label:	'Type',
								id:		'type',
								choices: [ {
									id:		`${chID}/`,
									label:	`${theStrip.description} ${theStrip.min}-${theStrip.max}`
								} ],
								default: chID + '/'
							},
							{
								type: 'number',
								label: theStrip.description,
								id: 'num',
								default: 1,
								min: theStrip.min,
								max: theStrip.max,
								range: false,
								required: true
							},
							{
								type:	'dropdown',
								label:	'Value',
								id:		'set',
								default: '2',
								choices: [
									{id: '1', label: 'On'},
									{id: '0', label: 'Off'},
									{id: '2', label: 'Toggle'}
								]
							}
						]
					}
				}
			}

			console.log(`${chID}/${defProc[p].node} "${theStrip.description} ${defProc[p].desc}"`);
		}

		if (muteID in muteActions) {
			muteActions[muteID].options[0].choices.push({
				id:    chID + '/',
				label: theStrip.description + " " + theStrip.min + "-" + theStrip.max
			});
			l = muteActions[muteID].options[1].label + ", " + theStrip.description;
			muteActions[muteID].options[1].label = l;
		} else {
			if (theStrip.hasOn == true) {
				if (d>0) {					// one of the channel mutes
					muteActions[muteID] = {
						label: "Mute " + theStrip.description,
						options: [
							{
								type:	'dropdown',
								label:	'Type',
								id:		'type',
								choices: [ {
									id: 	chID + '/',
									label: theStrip.description + " "  + theStrip.min + "-" + theStrip.max
								} ],
								default: chID + '/'
							},
							{
								type: 'number',
								label: theStrip.description,
								id: 'num',
								default: 1,
								min: theStrip.min,
								max: theStrip.max,
								range: false,
								required: true
							}
						]
					};
				} else {						// Main LR, Aux/USB
					muteActions[muteID] = {
						label: "Mute " + theStrip.description,
						options: []
					};
				}
			} else {							// Mute Group
				muteActions[muteID] = {
					label: theStrip.description,
					options: [
						{
							type:	'number',
							label:	theStrip.description + " " + theStrip.min + "-" + theStrip.max,
							id:		'mute_grp',
							default:'1',
							min: theStrip.min,
							max: theStrip.max,
							range: false,
							required: true
						}
					]
				};
			}

			muteActions[muteID].options.push( {
				type:	'dropdown',
				label:	'Mute / Unmute',
				id:		'mute',
				default: '2',
				choices: [
					{id: muteChoice[0], label: 'Mute'},
					{id: muteChoice[1], label: 'Unmute'},
					{id: '2', 			label: 'Toggle'}
					]
				}
			);
			muteActions[muteID].order = i;
		}

		// add new channel type to dropdown choices
		if (fadeActions[fadeID] !== undefined) {
			fadeActions[fadeID].options[0].choices.push({
				id:    chID + '/',
				label: theStrip.description + " " + theStrip.min + "-" + theStrip.max
			});
			l = fadeActions[fadeID].options[1].label + ", " + theStrip.description;
			fadeActions[fadeID].options[1].label = l;

			fadeActions[fadeID + '_a'].options[0].choices.push({
				id:    chID + '/',
				label: theStrip.description + " " + theStrip.min + "-" + theStrip.max
			});
			l = fadeActions[fadeID + '_a'].options[1].label + ", " + theStrip.description;
			fadeActions[fadeID + '_a'].options[1].label = l;

			storeActions[fadeID + '_s'].options[0].choices.push({
				id:    chID + '/',
				label: theStrip.description + " " + theStrip.min + "-" + theStrip.max
			});
			l = storeActions[fadeID + '_s'].options[1].label + ", " + theStrip.description;
			storeActions[fadeID + '_s'].options[1].label = l;

			storeActions[fadeID + '_r'].options[0].choices.push({
				id:    chID + '/',
				label: theStrip.description + " " + theStrip.min + "-" + theStrip.max
			});
			l = storeActions[fadeID + '_r'].options[1].label + ", " + theStrip.description;
			storeActions[fadeID + '_r'].options[1].label = l;

		} else {	// new strip
			if (theStrip.hasOn == true) {
				if (d>0) {					// one of the channel strips
					fadeActions[fadeID] = {
						label: "Fader Set",
						options: [
							{
								type:	'dropdown',
								label:	'Type',
								id:		'type',
								choices: [ {
									id: 	chID + '/',
									label: theStrip.description + " "  + theStrip.min + "-" + theStrip.max
								} ],
								default: chID + '/'
							},
							{
								type: 'number',
								label: theStrip.description,
								id: 'num',
								default: 1,
								min: theStrip.min,
								max: theStrip.max,
								range: false,
								required: true
							}
						]
					};

					fadeActions[fadeID+'_a'] = {
						label: "Fader Adjust",
						options: [
							{
								type:	'dropdown',
								label:	'Type',
								id:		'type',
								choices: [ {
									id: 	chID + '/',
									label: theStrip.description + " "  + theStrip.min + "-" + theStrip.max
								} ],
								default: chID + '/'
							},
							{
								type: 'number',
								label: theStrip.description,
								id: 'num',
								default: 1,
								min: theStrip.min,
								max: theStrip.max,
								range: false,
								required: true
							}
						]
					};

					storeActions[fadeID+'_s'] = {
						label: "Store Fader",
						options: [
							{
								type:	'dropdown',
								label:	'Type',
								id:		'type',
								choices: [ {
									id: 	chID + '/',
									label: theStrip.description + " "  + theStrip.min + "-" + theStrip.max
								} ],
								default: chID + '/'
							},
							{
								type: 'number',
								label: theStrip.description,
								id: 'num',
								default: 1,
								min: theStrip.min,
								max: theStrip.max,
								range: false,
								required: true
							}
						]
					};

					storeActions[fadeID+'_r'] = {
						label: "Recall Fader",
						options: [
							{
								type:	'dropdown',
								label:	'Type',
								id:		'type',
								choices: [ {
									id: 	chID + '/',
									label: theStrip.description + " "  + theStrip.min + "-" + theStrip.max
								} ],
								default: chID + '/'
							},
							{
								type: 'number',
								label: theStrip.description,
								id: 'num',
								default: 1,
								min: theStrip.min,
								max: theStrip.max,
								range: false,
								required: true
							}
						]
					};
				} else {						// Main LR, Aux/USB
					fadeActions[fadeID] = {
						label: theStrip.description + " Fader Set",
						options: []
					};
					fadeActions[fadeID+'_a'] = {
						label: theStrip.description + " Fader Adjust",
						options: []
					};
					storeActions[fadeID+'_s'] = {
						label: "Store " + theStrip.description + " Fader",
						options: []
					};
					storeActions[fadeID+'_r'] = {
						label: "Recall " + theStrip.description + " Fader",
						options: []
					};

				}	// else mute group (no fader)
			}

			if (theStrip.hasOn) {
				fadeActions[fadeID].options.push( {
					type:	'dropdown',
					label:	'Fader Level',
					id:		'fad',
					default: '0.0',
					choices: self.FADER_VALUES
				});

				fadeActions[fadeID].order = i;

				fadeActions[fadeID + '_a'].options.push( {
					type:	 'number',
					tooltip:	 "Move fader +/- percent.\nFader Percent:\n0 = -oo, 75 = 0db, 100 = +10db",
					label:	 'Adjust',
					id:		 'ticks',
					min:	 -100,
					max:	 100,
					default: 1
				});

				fadeActions[fadeID + '_a'].order = i;

				for (var sfx of ['','_a']) {
					fadeActions[fadeID + sfx].options.push( {
						type: 'number',
						label: 'Fade Duration (ms)',
						id: 'duration',
						default: 0,
						min: 0,
						step: 10,
						max: 60000
					});
				}

				storeActions[fadeID + '_s'].options.push( {
					type:	 'dropdown',
					tooltip:	 "Store fader value for later recall",
					label:	 'Where',
					id:		 'store',
					default: 'me',
					choices: [
						{ 	id: 'me',
							label: "Channel"
						},
						...self.STORE_LOCATION
					]
				});

				storeActions[fadeID + '_s'].order = i;

				storeActions[fadeID + '_r'].options.push( {
					type:	 'dropdown',
					tooltip:	 "Recall stored fader value",
					label:	 'From',
					id:		 'store',
					default: 'me',
					choices: [
						{ 	id: 'me',
							label: "Channel"
						},
						...self.STORE_LOCATION
					]
				});

				storeActions[fadeID + '_r'].options.push( {
					type: 'number',
					label: 'Fade Duration (ms)',
					id: 'duration',
					default: 0,
					min: 0,
					step: 10,
					max: 60000
				});

				storeActions[fadeID + '_r'].order = i;

			}
		}

		// add channel type to send actions
		if (theStrip.hasLevel) {
			sendID = 'send';
			if (sendActions[sendID] !== undefined) {
				sendActions[sendID].options[0].choices.push({
					id:    chID + '/',
					label: sendLabel(theStrip.description, theStrip.min, theStrip.max)
				});
				l = sendActions[sendID].options[1].label + ", " + theStrip.description;
				sendActions[sendID].options[1].label = l;

				sendActions[sendID + '_a'].options[0].choices.push({
					id:    chID + '/',
					label: sendLabel(theStrip.description, theStrip.min, theStrip.max)
				});
				l = sendActions[sendID + '_a'].options[1].label + ", " + theStrip.description;
				sendActions[sendID + '_a'].options[1].label = l;

				storeActions[sendID + '_s'].options[0].choices.push({
					id:    chID + '/',
					label: sendLabel(theStrip.description, theStrip.min, theStrip.max)
				});
				l = storeActions[sendID + '_s'].options[1].label + ", " + theStrip.description;
				storeActions[sendID + '_s'].options[1].label = l;

				storeActions[sendID + '_r'].options[0].choices.push({
					id:    chID + '/',
					label: sendLabel(theStrip.description, theStrip.min, theStrip.max)
				});
				l = storeActions[sendID + '_r'].options[1].label + ", " + theStrip.description;
				storeActions[sendID + '_r'].options[1].label = l;

			} else { // new channel
				sendActions[sendID] = {
					label: "Send Level Set",
					options: [
						{
							type:	'dropdown',
							label:	'Type',
							id:		'type',
							choices: [ {
								id: 	chID + '/',
								label: sendLabel(theStrip.description, theStrip.min, theStrip.max)
							} ],
							default: chID + '/'
						},
						{
							type: 'number',
							label: theStrip.description,
							id: 'chNum',
							default: 1,
							min: theStrip.min,
							max: theStrip.max,
							range: false,
							required: true
						},
						{
							type:	'dropdown',
							label:	'Bus',
							id:		'busNum',
							choices: busOpts,
							default: 1
						},
						{
							type:	'dropdown',
							label:	"Fader Level",
							id:		'fad',
							default: '0.0',
							choices: self.FADER_VALUES
						}

					]
				};

				sendActions[sendID + '_a'] = {
					label: "Send Level Adjust",
					options: [
						{
							type:	'dropdown',
							label:	'Type',
							id:		'type',
							choices: [ {
								id: 	chID + '/',
								label: sendLabel(theStrip.description, theStrip.min, theStrip.max)

							} ],
							default: chID + '/'
						},
						{
							type: 'number',
							label: theStrip.description,
							id: 'chNum',
							default: 1,
							min: theStrip.min,
							max: theStrip.max,
							range: false,
							required: true
						},
						{
							type:	'dropdown',
							label:	'Bus',
							id:		'busNum',
							choices: busOpts,
							default: 1
						},
						{
							type:	 'number',
							title:	 "Move fader +/- percent.\nFader percent:\n0 = -oo, 75 = 0db, 100 = +10db",
							label:	 "Adjust",
							id:		 'ticks',
							min:	 -100,
							max:	 100,
							default: 1
						}
					]
				};


				for (var sfx of ['','_a']) {
					sendActions[sendID + sfx].options.push( {
						type: 'number',
						label: 'Fade Duration (ms)',
						id: 'duration',
						default: 0,
						min: 0,
						step: 10,
						max: 60000
					});
				}

				storeActions[sendID + '_s'] = {
					label: "Store Send Level",
					options: [
						{
							type:	'dropdown',
							label:	'Type',
							id:		'type',
							choices: [ {
								id: 	chID + '/',
								label: sendLabel(theStrip.description, theStrip.min, theStrip.max)
							} ],
							default: chID + '/'
						},
						{
							type: 'number',
							label: theStrip.description,
							id: 'chNum',
							default: 1,
							min: theStrip.min,
							max: theStrip.max,
							range: false,
							required: true
						},
						{
							type:	'dropdown',
							label:	'Bus',
							id:		'busNum',
							choices: busOpts,
							default: 1
						},
						{
							type:	 'dropdown',
							tooltip:	 "Store send value for later recall",
							label:	 'Where',
							id:		 'store',
							default: 'me',
							choices: [
								{ 	id: 'me',
									label: "Channel"
								},
								...self.STORE_LOCATION
							]
						}
					]
				};

				storeActions[sendID + '_r'] = {
					label: "Recall Send Level",
					options: [
						{
							type:	'dropdown',
							label:	'Type',
							id:		'type',
							choices: [ {
								id: 	chID + '/',
								label: sendLabel(theStrip.description, theStrip.min, theStrip.max)
							} ],
							default: chID + '/'
						},
						{
							type: 'number',
							label: theStrip.description,
							id: 'chNum',
							default: 1,
							min: theStrip.min,
							max: theStrip.max,
							range: false,
							required: true
						},
						{
							type:	'dropdown',
							label:	'Bus',
							id:		'busNum',
							choices: busOpts,
							default: 1
						},
						{
							type:	 'dropdown',
							tooltip: "Recall stored send value",
							label:	 'From',
							id:		 'store',
							default: 'me',
							choices: [
								{ 	id: 'me',
									label: "Channel"
								},
								...self.STORE_LOCATION
							]
						}
					]
				};

				storeActions[sendID + '_r'].options.push( {
					type: 'number',
					label: 'Fade Duration (ms)',
					id: 'duration',
					default: 0,
					min: 0,
					step: 10,
					max: 60000
				});
			}
		}

		if (d == 0) {
			theID = chID + muteSfx;
			self.fbToStat[fbID] = theID;
			stat[theID] = {
				isOn: false,
				hasOn: theStrip.hasOn,
				valid: false,
				fbID: fbID,
				polled: 0
			};
			// 'proc' routing toggles
			for (var p of theStrip.proc) {
				theID = `${chID}/${defProc[p].node}`;
				fID = bx_unslash(fbID) + '_' + p
				stat[theID] = {
					isOn: false,
					hasOn: true,
					valid: false,
					fbID: fID,
					polled: 0
				};
				self.fbToStat[fID] = theID;
			};
			theID = chID + fadeSfx;
			fID = 'f_' + bx_unslash(fbID);
			self.fbToStat[fID] = theID;
			stat[theID] = {
				fader: 0.0,
				valid: false,
				fbID: fID,
				fSteps: 1024,
				varID: fID,
				polled: 0
			};
			defVariables.push({
				label: theStrip.description + " dB",
				name: fID + "_d"
			});
			defVariables.push({
				label: theStrip.description + " %",
				name: fID + "_p"
			});
			defVariables.push({
				label: theStrip.description + " % Relative Loudness",
				name: fID + "_rp"
			});
			if ('' != labelSfx) {
				theID = chID + labelSfx + "/name";
				fID = 'l_' + bx_unslash(fbID);
				self.fbToStat[fID] = theID;
				stat[theID] = {
					name: fbID,
					defaultName: defaultLabel,
					valid: false,
					fbID: fID,
					polled: 0
				};
				defVariables.push({
					label: theStrip.description + " Label",
					name: fID
				});
				theID = chID + labelSfx + "/color";
				fID = 'c_' + bx_unslash(fbID);
				self.fbToStat[fID] = theID;
				stat[theID] = {
					color: 0,
					valid: false,
					fbID: fID,
					polled: 0
				};
			}
			if (theStrip.hasLevel) {
				for (b = 1; b<11; b++) {
					bOrF = (b < 7 ? 'b' : 'f');
					sChan = (b < 7 ? b : b-6);
					theID = chID + '/mix/' + bx_pad2(b) + '/level';
					sendID = (b<7 ? " Bus " + b : " FX " + (b - 6) );
					fID = 's_' + bx_unslash(fbID) + c + '_' + bOrF + sChan;
					self.fbToStat[fID] = theID;
					stat[theID] = {
						level: 0.0,
						valid: false,
						fbID: fID,
						fSteps: 161,
						varID: fID,
						polled: 0
					};
					defVariables.push({
						label: capFirst(fbID) + " " + c + sendID + " dB",
						name: fID + "_d"
					});
					defVariables.push({
						label: capFirst(fbID) + " " + c + sendID + " %",
						name: fID + "_p"
					});
					defVariables.push({
						label: capFirst(fbID) + " " + c + sendID + " % Relative Loudness",
						name: fID + "_rp"
					});
				}
			}
		} else {
			for (c = theStrip.min; c <= theStrip.max; c++) {
				theID = chID + '/' + bx_pad2(c,d) + muteSfx;
				fID = fbID + '_' + c;
				self.fbToStat[fID] = theID;
				stat[theID] = {
					isOn: false,
					hasOn: theStrip.hasOn,
					valid: false,
					fbID: fbID,
					polled: 0
				};
				// 'proc' routing toggles
				for (var p of theStrip.proc) {
					theID = `${chID}/${bx_pad2(c,d)}/${defProc[p].node}`;
					fpID = `${bx_unslash(fbID)}_${p}`;
					fID = `${fpID}${c}`;
					self.fbToStat[fID] = theID;
					stat[theID] = {
						isOn: false,
						hasOn: true,
						valid: false,
						fbID: fpID,
						polled: 0
					};
				};
				if ('' != fadeSfx) {
					theID = chID  + '/' + bx_pad2(c,d) + fadeSfx;
					fID = 'f_' + bx_unslash(fbID) + c;
					self.fbToStat[fID] = theID;
					stat[theID] = {
						fader: 0.0,
						valid: false,
						fSteps: 1024,
						fbID: fID,
						varID: fID,
						polled: 0
					};
					defVariables.push({
						label: theStrip.description + " " + c + " dB",
						name: fID + "_d"
					});
					defVariables.push({
						label: theStrip.description + " " + c + " %",
						name: fID + "_p"
					});
					defVariables.push({
						label: theStrip.description + " " + c + " % Relative Loudness",
						name: fID + "_rp"
					});
					if (theStrip.hasLevel) {
						for (b = 1; b<11; b++) {
							bOrF = (b < 7 ? 'b' : 'f');
							sChan = (b < 7 ? b : b-6);
							theID = chID + '/' + bx_pad2(c,d) + '/mix/' + bx_pad2(b) + '/level';
							sendID = (b<7 ? " Bus " + b : " FX " + (b - 6) );
							fID = 's_' + bx_unslash(fbID) + c + '_' + bOrF + sChan;
							self.fbToStat[fID] = theID;
							stat[theID] = {
								level: 0.0,
								valid: false,
								fbID: fID,
								fSteps: 161,
								varID: fID,
								polled: 0
							};
							defVariables.push({
								label: capFirst(fbID) + " " + c + sendID + " dB",
								name: fID + "_d"
							});
							defVariables.push({
								label: capFirst(fbID) + " " + c + sendID + " %",
								name: fID + "_p"
							});
							defVariables.push({
								label: capFirst(fbID) + " " + c + sendID + " % Relative Loudness",
								name: fID + "_rp"
							});
							
						}
					}
				}
				if ('' != labelSfx) {
					theID = chID + '/' + bx_pad2(c,d) + labelSfx + "/name";
					fID = 'l_' + bx_unslash(fbID) + c;
					self.fbToStat[fID] = theID;
					stat[theID] = {
						name: fbID + c,
						defaultName: defaultLabel + c,
						valid: false,
						fbID: fID,
						polled: 0
					};
					defVariables.push({
						label: theStrip.description + " " + c + " Label",
						name: fID
					});
					theID = chID + '/' + bx_pad2(c,d) + labelSfx + "/color";
					fID = 'c_' + bx_unslash(fbID) + c;
					self.fbToStat[fID] = theID;
					stat[theID] = {
						color: 0,
						valid: false,
						fbID: 'c_' + bx_unslash(fbID),
						polled: 0
					};
				}
			}
		}

		// mute feedback defs
		fbDescription = theStrip.description + " " + (theStrip.hasOn ? "Mute" : "") + " status";
		muteFeedbacks[fbID] = {
			type: 'boolean',
			label: 		 "Indicate " + fbDescription,
			description: "Indicate " + fbDescription + " on button",
			options: [
				{
					type:	'dropdown',
					label:	'State',
					id:		'state',
					default: '1',
					choices: [
						{id: '1', label: 'On'},
						{id: '0', label: 'Off'}
					]
				}
			],
			style: {
				color: self.rgb(255, 255, 255),
				bgcolor: self.rgb(128, 0, 0)
			},
			callback: function(feedback, bank) {
				var theChannel = feedback.options.theChannel;
				var fbType = feedback.type;
				var stat;
				var state = feedback.options.state != '0';

				if (theChannel) {
					stat = self.xStat[self.fbToStat[fbType + '_' + theChannel]];
				} else if ( self.fbToStat[fbType] ) {
					stat = self.xStat[self.fbToStat[fbType]];
				}
				return (stat.isOn != stat.hasOn) == state;
			}
		};
		if (d>0) {
			muteFeedbacks[fbID].options.push( {
				type: 'number',
				label: theStrip.description + ' number',
				id: 'theChannel',
				default: 1,
				min: theStrip.min,
				max: theStrip.max,
				range: false,
				required: true
			} );
		}
		// 'proc' routing toggles
		for (var p of theStrip.proc) {
			fbDescription = `${theStrip.description} ${defProc[p].desc} status`;
			fID = `${fbID}_${p}`;
			muteFeedbacks[fID] = {
				type: 		'boolean',
				label: 		 "Indicate " + fbDescription,
				description: "Indicate " + fbDescription + " on button",
				options: [
					{
						type:	'dropdown',
						label:	'State',
						id:		'state',
						default: '1',
						choices: [
							{id: '1', label: 'On'},
							{id: '0', label: 'Off'}
						]
					}
				],
				style: {
					color: self.rgb(192,192,192),
					bgcolor: self.rgb(0, 92, 128)
				},
				callback: function(feedback, bank) {
					var theChannel = feedback.options.theChannel;
					var fbType = feedback.type;
					var stat;
					var state = feedback.options.state != '0';

					if (theChannel) {
						stat = self.xStat[self.fbToStat[fbType + theChannel]];
					} else if ( self.fbToStat[fbType] ) {
						stat = self.xStat[self.fbToStat[fbType]];
					}
					return (stat.isOn  == state);
				}
			};
			if (d>0) {
				muteFeedbacks[fID].options.push( {
					type: 'number',
					label: theStrip.description + ' number',
					id: 'theChannel',
					default: 1,
					min: theStrip.min,
					max: theStrip.max,
					range: false,
					required: true
				} );
			}
		}

		// channel color feedbacks
		if (theStrip.hasOn) {
			fbDescription = theStrip.description + " label";
			var cID = 'c_' + bx_unslash(fbID);
			colorFeedbacks[cID] = {
				label: 		 "Color of " + fbDescription,
				description: "Use button colors from " + fbDescription,
				options: [],
				callback: function(feedback, bank) {
					var theChannel = feedback.options.theChannel;
					var fbType = feedback.type;
					var stat;
					if (theChannel) {
						stat = self.xStat[self.fbToStat[fbType + theChannel]];
					} else if ( self.fbToStat[fbType] ) {
						stat = self.xStat[self.fbToStat[fbType]];
					}
					return { color: self.COLOR_VALUES[stat.color].fg, bgcolor: self.COLOR_VALUES[stat.color].bg };
				}
			};
			if (d>0) {
				colorFeedbacks[cID].options.push( {
					type: 'number',
					label: theStrip.description + ' number',
					id: 'theChannel',
					default: 1,
					min: theStrip.min,
					max: theStrip.max,
					range: false,
					required: true
				} );
			}
		}
	}
	self.xStat = stat;
	self.variableDefs = defVariables;
	self.actionDefs = fadeActions;
	Object.assign(self.actionDefs, sendActions);
	Object.assign(self.actionDefs, muteActions);
	Object.assign(self.actionDefs, procActions);
	Object.assign(self.actionDefs, storeActions);
	self.muteFeedbacks = muteFeedbacks;
	self.colorFeedbacks = colorFeedbacks;
};

instance.prototype.pollStats = function () {
	var self = this;
	var stillNeed = false;
	var counter = 0;
	var timeNow = Date.now();
	var timeOut = timeNow - self.PollTimeout;
	var id;

	for (id in self.xStat) {
		if (!self.xStat[id].valid) {
			stillNeed = true;
			if (self.xStat[id].polled < timeOut) {
				self.sendOSC(id);
				// self.debug("sending " + id);
				self.xStat[id].polled = timeNow;
				counter++;
				if (counter > self.PollCount) {
					break;
				}
			}
		}
	}

	if (!stillNeed) {
		self.status(self.STATUS_OK,"Mixer Status loaded");
		var c = Object.keys(self.xStat).length;
		var d = (timeNow - self.timeStart) / 1000;
		self.log('info', 'Sync complete (' + c + '@' + (c / d).toFixed(1) + ')');
	}
	self.needStats = stillNeed;
};

instance.prototype.firstPoll = function () {
	var self = this;
	var id;

	self.sendOSC('/xinfo',[]);
	self.sendOSC('/-snap/index',[]);
	self.sendOSC('/-snap/name',[]);
	self.timeStart = Date.now();
	self.pollStats();
	self.pulse();
};

instance.prototype.stepsToFader = function (i, steps) {
	var res = i / ( steps - 1 );

	return Math.floor(res * 10000) / 10000;
};

instance.prototype.faderToDB = function ( f, steps , rp) {
// “f” represents OSC float data. f: [0.0, 1.0]
// “d” represents the dB float data. d:[-oo, +10]
// if "rp" (Relative percent) is true, the function returns a loudness perceptual (base 10/33.22) change in % compared to unity (0dB)
	var d = 0;

	if (f >= 0.5) {
		d = f * 40.0 - 30.0;		// max dB value: +10.
	} else if (f >= 0.25) {
		d = f * 80.0 - 50.0;
	} else if (f >= 0.0625) {
		d = f * 160.0 - 70.0;
	} else if (f >= 0.0) {
		d = f * 480.0 - 90.0;		// min dB value: -90 or -oo
	}
	return (f==0 ? (rp ? "0":"-oo") : (rp? "":d>0 ? '+':'') + (rp? (100 * 10 ** (d/33.22)) : Math.round(d * 1023.5) / 1024).toFixed(1));
};

instance.prototype.init_osc = function() {
	var self = this;
	var host = self.config.host;

	if (self.oscPort) {
		self.oscPort.close();
	}
	if (self.config.host) {
		self.oscPort = new OSC.UDPPort ({
			localAddress: "0.0.0.0",
			localPort: 10024 + self.port_offset,
			remoteAddress: self.config.host,
			remotePort: 10024,
			metadata: true
		});

		// listen for incoming messages
		self.oscPort.on('message', function(message, timeTag, info) {
			var args = message.args;
			var node = message.address;
			var leaf = node.split('/').pop();

			// debug("received ", message, "from", info);
			if (self.xStat[node] !== undefined) {
				var v = args[0].value;
				switch (leaf) {
				case 'on':
				case 'lr':
					self.xStat[node].isOn = (v == 1);
					self.checkFeedbacks(self.xStat[node].fbID);
					break;
				case '1':
				case '2':
				case '3':
				case '4': // '/config/mute/#'
					self.xStat[node].isOn = (v == 1);
					self.checkFeedbacks(self.xStat[node].fbID);
					break;
				case 'fader':
				case 'level':
					v = Math.floor(v * 10000) / 10000;
					self.xStat[node][leaf] = v;
					self.setVariable(self.xStat[node].varID + '_p',Math.round(v * 100));
					self.setVariable(self.xStat[node].varID + '_d',self.faderToDB(v,1024,false));
					self.setVariable(self.xStat[node].varID + '_rp',Math.round(self.faderToDB(v,1024,true)));
					self.xStat[node].idx = self.fLevels[self.xStat[node].fSteps].findIndex((i) => i >= v);
					break;
				case 'name':
					// no name, use behringer default
					if (v=='') {
						v = self.xStat[node].defaultName;
					}
					self.xStat[node].name = v;
					self.setVariable(self.xStat[node].fbID, v);
					break;
				case 'color':
					self.xStat[node].color = v;
					self.checkFeedbacks(self.xStat[node].fbID);
					break;
				case 'mono':
				case 'dim':
				case 'mute':	// '/config/solo/'
					self.xStat[node].isOn = v;
					self.checkFeedbacks(self.xStat[node].fbID);
					break;
				default:
					if (node.match(/\/solo/)) {
						self.xStat[node].isOn = v;
						self.checkFeedbacks(self.xStat[node].fbID);
					}
				}
				self.xStat[node].valid = true;
				if (self.needStats) {
					self.pollStats();
				}
				debug(message);
			} else if (node.match(/^\/xinfo$/)) {
				self.myMixer.name = args[1].value;
				self.myMixer.model = args[2].value;
				self.myMixer.fw = args[3].value;
				self.setVariable('m_name',	self.myMixer.name);
				self.setVariable('m_model', self.myMixer.model);
				self.setVariable('m_fw', self.myMixer.fw);
			} else if (node.match(/^\/\-snap\/name$/)) {
				var n = args[0].value;
				self.snapshot[self.currentSnapshot].name = n;
				self.setVariable('s_name', n);
			} else if (node.match(/^\/\-snap\/index$/)) {
				var s = parseInt(args[0].value);
				var n = self.xStat[self.snapshot[s]].name;
				self.currentSnapshot = s;
				self.setVariable('s_index', s);
				self.checkFeedbacks('snap_color');
				self.setVariable('s_name', n);
				self.setVariable('s_name_' + bx_pad2(s), n);
				self.sendOSC('/-snap/' + bx_pad2(s) + '/name',[]);
			} else if (node.match(/^\/\-snap\/\d\d\/name$/)) {
				var s;
				self.snapshot[s] = arg[0];
				self.setVariable(`s_name_${s}`, arg[0]);
			}
			// else {
			// 	debug(message.address, args);
			// }
		});

		self.oscPort.on('ready', function() {
			self.status(self.STATUS_WARNING,"Loading status");
			self.log('info', 'Sync started');
			self.firstPoll();
			self.heartbeat = setInterval( function () { self.pulse(); }, 9500);
			self.blinker = setInterval( function() { self.blink(); }, 1000);
			self.fader = setInterval( function() { self.doFades(); }, 1000 / self.fadeResolution);
		});

		self.oscPort.on('close', function() {
			if (self.heartbeat) {
				clearInterval(self.heartbeat);
				delete self.heartbeat;
			}
			if (self.blinker) {
				clearInterval(self.blinker);
				delete self.blinker;
			}
			if (self.fader) {
				clearInterval(self.fader);
				delete self.fader;
			}
		});

		self.oscPort.on('error', function(err) {
			self.log('error', "Error: " + err.message);
			self.status(self.STATUS_ERROR, err.message);
			if (self.heartbeat) {
				clearInterval(self.heartbeat);
				delete self.heartbeat;
			}
			if (self.blinker) {
				clearInterval(self.blinker);
				delete self.blinker;
			}
			if (self.fader) {
				clearInterval(self.fader);
				delete self.fader;
			}
		});

		self.oscPort.open();
	}
};

// define instance variables
instance.prototype.init_variables = function() {
	var self = this;

	var variables = [
		{
			label: 'XAir Mixer Name',
			name:  'm_name'
		},
		{
			label: 'XAir Mixer Model',
			name:  'm_model'
		},
		{
			label: 'XAir Mixer Firmware',
			name:  'm_fw'
		},
		{
			label: 'Current Snapshot Name',
			name:  's_name'
		},
		{
			label: 'Current Snapshot Index',
			name:  's_index'
		}
	];
	variables.push.apply(variables, self.variableDefs);

	for (var i in variables) {
		self.setVariable(variables[i].name);
	}
	self.setVariableDefinitions(variables);
};

// define instance feedbacks
instance.prototype.init_feedbacks = function() {
	var self = this;

	var feedbacks = {
		snap_color: {
			label: 'Color on Current Snapshot',
			description: 'Set Button colors when this Snapshot is loaded',
			options: [
				{
					type: 'colorpicker',
					label: 'Foreground color',
					id: 'fg',
					default: '16777215'
				},
				{
					type: 'colorpicker',
					label: 'Background color',
					id: 'bg',
					default: self.rgb(0, 128, 0)
				},
				{
					type: 'number',
					label: 'Snapshot to match',
					id: 'theSnap',
					default: 1,
					min: 1,
					max: 64,
					range: false,
					required: true
				}
			],
			callback: function(feedback, bank) {
				if (feedback.options.theSnap == self.currentSnapshot) {
					return { color: feedback.options.fg, bgcolor: feedback.options.bg };
				}
			}
		}
	};
	Object.assign(feedbacks,this.muteFeedbacks);
	Object.assign(feedbacks,this.colorFeedbacks);
	this.setFeedbackDefinitions(feedbacks);
};

// Return config fields for web config
instance.prototype.config_fields = function () {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'Target IP',
			tooltip: 'The IP of the Mr / Xr console',
			width: 6,
			regex: this.REGEX_IP
		}
	];
};

// When module gets deleted
instance.prototype.destroy = function() {
	var self = this;

	if (self.heartbeat) {
		clearInterval(self.heartbeat);
		delete self.heartbeat;
	}
	if (self.blinker) {
		clearInterval(self.blinker);
		delete self.blinker;
	}
	if (self.fader) {
		clearInterval(self.fader);
		delete self.fader;
	}
	if (self.oscPort) {
		self.oscPort.close();
	}
	debug("destroy", self.id);
};

instance.prototype.sendOSC = function (node, arg) {
	var self = this;
	var host = "";

	if (self.oscPort) {
		self.oscPort.send({
			address: node,
			args: arg
		});
	}
};

instance.prototype.setConstants = function() {
	var self = this;

	// discreet float values for faders (1024)
	for (var i = 0; i < 1024; i++) {
		self.fLevels[1024][i] = Math.min(1.0,Math.floor(Math.round(self.stepsToFader(i, 1024) * 1023.5) / 1023 * 10000) / 10000);
	}

	// discreet float values for sends (161)
	for (var i = 0; i < 161; i++) {
		self.fLevels[161][i] = self.stepsToFader(i,161);
	}

	self.STORE_LOCATION = [];

	for (var i = 1; i <=10; i++) {
		var i2 = bx_pad2(i);

		self.STORE_LOCATION.push( {
			label: `Global ${i}`,
			id: `gs_${i2}`
		});
	}

	self.FADER_VALUES = [
		{ label: '- ∞',        id: '0.0' },
		{ label: '-50 dB: ',   id: '0.1251' },
		{ label: '-30 dB',     id: '0.251' },
		{ label: '-20 dB',     id: '0.375' },
		{ label: '-18 dB',     id: '0.4' },
		{ label: '-15 dB',     id: '0.437' },
		{ label: '-12 dB',     id: '0.475' },
		{ label: '-9 dB',      id: '0.525' },
		{ label: '-6 dB',      id: '0.6' },
		{ label: '-3 dB',      id: '0.675' },
		{ label: '-2 dB',      id: '0.7' },
		{ label: '-1 dB',      id: '0.725' },
		{ label: '0 dB',       id: '0.75' },
		{ label: '+1 dB',      id: '0.775' },
		{ label: '+2 dB',      id: '0.8' },
		{ label: '+3 dB',      id: '0.825' },
		{ label: '+4 dB',      id: '0.85' },
		{ label: '+5 dB',      id: '0.875' },
		{ label: '+6 dB',      id: '0.9' },
		{ label: '+9 dB',      id: '0.975' },
		{ label: '+10 dB',     id: '1.0' }
	];

	self.COLOR_VALUES = [
		{ label: 'Off',              id: '0',	bg: 0, fg: self.rgb( 64, 64, 64) },
		{ label: 'Red: ',            id: '1',	bg: self.rgb(224,  0,  0), fg: 0 },
		{ label: 'Green',            id: '2',	bg: self.rgb(  0,224,  0), fg: 0 },
		{ label: 'Yellow',           id: '3',	bg: self.rgb(224,224,  0), fg: 0 },
		{ label: 'Blue',             id: '4',	bg: self.rgb(  0,  0,224), fg: 0 },
		{ label: 'Magenta',          id: '5',	bg: self.rgb(224,  0,224), fg: 0 },
		{ label: 'Cyan',             id: '6',	bg: self.rgb(  0,192,224), fg: 0 },
		{ label: 'White',            id: '7',	bg: self.rgb(224,224,224), fg: 0 },
		{ label: 'Off Inverted',     id: '8',	bg: self.rgb( 64, 64, 64), fg: 0 },
		{ label: 'Red Inverted',     id: '9',	bg: 0, fg: self.rgb(224,  0,  0) },
		{ label: 'Green Inverted',   id: '10',	bg: 0, fg: self.rgb(  0,224,  0) },
		{ label: 'Yellow Inverted',  id: '11',	bg: 0, fg: self.rgb(224,224,  0) },
		{ label: 'Blue Inverted',    id: '12',	bg: 0, fg: self.rgb(  0,  0,224) },
		{ label: 'Magenta Inverted', id: '13',	bg: 0, fg: self.rgb(224,  0,224) },
		{ label: 'Cyan Inverted',    id: '14',	bg: 0, fg: self.rgb(  0,192,224) },
		{ label: 'White Inverted',   id: '15',	bg: 0, fg: self.rgb(224,224,224) }
	];

	self.TAPE_FUNCITONS = [
		{ label: 'STOP',                id: '0' },
		{ label: 'PLAY PAUSE',          id: '1' },
		{ label: 'PLAY',                id: '2' },
		{ label: 'RECORD PAUSE',        id: '3' },
		{ label: 'RECORD',              id: '4' },
		{ label: 'FAST FORWARD',        id: '5' },
		{ label: 'REWIND',              id: '6' }
	];
};

instance.prototype.init_actions = function(system) {
	var self = this;
	var newActions = {};

	Object.assign(newActions, self.actionDefs, {

		'label':     {
			label:     'Set label',
			options: [
				{
					type:     'dropdown',
					label:    'Type',
					id:       'type',
					choices:  [
						{ id: '/ch/',      label: 'Channel 1-16' },
						{ id: '/rtn/',     label: 'Fx Return 1-4' },
						{ id: '/fxsend/',  label: 'Fx Send 1-4'  },
						{ id: '/bus/',     label: 'Bus 1-6'  }
					],
					default:  '/ch/'
				},
				{
					type:    'textinput',
					label:   'Channel, Fx Return, Fx Send or Bus Number',
					id:      'num',
					default: '1',
					regex: self.REGEX_NUMBER
				},
				{
					type:    'textinput',
					label:   'Label',
					id:      'lab',
					default: ''
				}
			]
		},

		'mLabel':     {
			label:       'Set Main label',
			options: [
				{
					type:    'textinput',
					label:   'Label',
					id:      'lab',
					default: ''
				}
			]
		},

		'usbLabel':     {
			label:       'Set USB label',
			options: [
				{
					type:    'textinput',
					label:   'Label',
					id:      'lab',
					default: 'USB'
				}
			]
		},

		'color':     {
			label:     'Set color',
			options: [
				{
					type:     'dropdown',
					label:    'Type',
					id:       'type',
					choices:  [
						{ id: '/ch/',      label: 'Channel 1-16' },
						{ id: '/rtn/',     label: 'Fx Return 1-4' },
						{ id: '/fxsend/',  label: 'Fx Send 1-4'  },
						{ id: '/bus/',     label: 'Bus 1-6'  }
					],
					default:  '/ch/'
				},
				{
					type:    'textinput',
					label:   'Channel, Fx Return, Fx Send or Bus Number',
					id:      'num',
					default: '1',
					regex:   self.REGEX_NUMBER
				},
				{
					type:    'dropdown',
					label:   'color',
					id:      'col',
					choices: self.COLOR_VALUES
				}
			]
		},

		'mColor':     {
			label:     'Set Main color',
			options: [
				{
					type:    'dropdown',
					label:   'color',
					id:      'col',
					choices: self.COLOR_VALUES
				}
			]
		},

		'usbColor':     {
			label:     'Set USB color',
			options: [
				{
					type:    'dropdown',
					label:   'color',
					id:      'col',
					choices: self.COLOR_VALUES
				}
			]
		},

		'load_snap':     {
			label:     'Load Console Snapshot',
			options: [
				{
					type:    'textinput',
					label:   'Snapshot Nr 1-64',
					id:      'snap',
					default: '1',
					regex:   self.REGEX_NUMBER
				}

			]
		},

		'next_snap':     {
			label:     'Load Next Console Snapshot',
			options: [ ]
		},

		'prev_snap':     {
			label:     'Load Prior Console Snapshot',
			options: [ ]
		},

		'save_snap':     {
			label:     'Save Current Console Snapshot',
			options: [ ]
		},

		'tape':     {
			label:     'Tape Operation',
			options: [

				{
					type:    'dropdown',
					label:   'Function',
					id:      'tFunc',
					choices: self.TAPE_FUNCITONS
				}
			]
		}
	});



	self.system.emit('instance_actions', self.id, newActions);
};

instance.prototype.action = function(action) {
	var self = this;
	var cmd;
	var subAct = action.action.slice(-2);
	var opt = action.options;
	var nVal, bVal, fVal;
	var arg = [];

	// calculate new fader/level float
	// returns a 'new' float value
	// or undefined for store or crossfade
	function fadeTo(cmd, opt) {
		var stat = self.xStat[cmd]
		var node = cmd.split('/').pop();
		var opTicks = parseInt(opt.ticks);
		var steps = stat.fSteps;
		var span = parseFloat(opt.duration);
		var oldVal = stat[node];
		var oldIdx = stat.idx;
		var byVal = opTicks * steps / 100;
		var newIdx = Math.min(steps-1,Math.max(0, oldIdx + Math.round(byVal)));
		var slot = opt.store == 'me' ? cmd : opt.store;
		var r, byVal, newIdx;

		switch (subAct) {
			case '_a':			// adjust +/- (pseudo %)
				byVal = opTicks * steps / 100;
				newIdx = Math.min(steps-1,Math.max(0, oldIdx + Math.round(byVal)));
				r = self.fLevels[steps][newIdx];
			break;
			case '_r':			// restore
				r = slot && self.tempStore[slot] ? self.tempStore[slot] : -1;
			break;
			case '_s':			// store
				if (slot) {		// sanity check
					self.tempStore[slot] = stat[node];
				}
				r = -1;
				// the 'store' actions are internal to this module only
				// r is left undefined since there is nothing to send
			break;
			default:			// set new value
				r = parseFloat(opt.fad);
		}
		// set up cross fade?
		if (span>0 && r >= 0) {
			var xSteps = span / (1000 / self.fadeResolution);
			var xDelta = Math.floor((r - oldVal) / xSteps * 10000) / 10000;
			if (xDelta == 0) { // already there
				r = -1;
			} else {
				self.crossFades[cmd] = {
					steps: xSteps,
					delta: xDelta,
					startVal: oldVal,
					finalVal: r,
					atStep: 1
				};
				// start the xfade
				r = oldVal + xDelta;
			}
		}
		// self.debug(`---------- ${oldIdx}:${oldVal} by ${byVal}(${opTicks}) fadeTo ${newIdx}:${r} ----------`);
		return r;
	}

	function setToggle(cmd, opt) {
		return 2 == parseInt(opt) ? 1-self.xStat[cmd].isOn : parseInt(opt);
	}

	switch (action.action){

		case 'mute':
			if (opt.type == '/ch/') {
				nVal = ('0' + parseInt(opt.num)).substr(-2);
			} else {
				nVal = parseInt(opt.num);
			}
			cmd = opt.type + nVal;
			if (opt.type == '/dca/') {
				cmd += '/on';
			} else {
				cmd += '/mix/on';
			}
			arg = {
				type: 'i',
				value: setToggle(cmd, opt.mute)
			};
		break;

		case 'gate':
		case 'dyn':
		case 'insert':
		case 'eq':
		case 'lr':
			if (opt.type == '/ch/') {
				nVal = ('0' + parseInt(opt.num)).substr(-2);
			} else {
				nVal = parseInt(opt.num);
			}
			if (action.action == 'lr') {
				cmd = opt.type + nVal + '/mix/lr';
			} else {
				cmd = opt.type + nVal + '/' + action.action + '/on';
			}
			arg = {
				type: 'i',
				value: setToggle(cmd, opt.set)
			};
		break;

		case 'mMute':
			cmd = '/lr/mix/on';
			arg = {
				type: 'i',
				value: setToggle(cmd, opt.mute)
			};
		break;

		case 'usbMute':
			cmd = '/rtn/aux/mix/on';
			arg = {
				type: 'i',
				value: setToggle(cmd, opt.mute)
			};
		break;

		case 'mute_grp':
			cmd = '/config/mute/'+ opt.mute_grp;
			arg = {
				type: 'i',
				value: setToggle(cmd, opt.mute)
			};
		break;

		case 'fad':
		case 'fad_a':
		case 'fad_s':
		case 'fad_r':
			if (opt.type == '/ch/') {
				nVal = ('0' + parseInt(opt.num)).substr(-2);
			} else {
				nVal = parseInt(opt.num);
			}
			cmd = opt.type + nVal;
			if (opt.type == '/dca/') {
				cmd += '/fader';
			} else {
				cmd += '/mix/fader';
			}
			if ((fVal = fadeTo(cmd, opt)) < 0) {
				cmd = undefined;
			} else {
				arg = {
					type: 'f',
					value: fVal
				};
			}
		break;

		case 'send':
		case 'send_a':
		case 'send_s':
		case 'send_r':
			switch (opt.type) {
			case '/ch/':
				nVal = ('0' + parseInt(opt.chNum)).substr(-2) + '/';
				break;
			case '/rtn/':
				nVal = parseInt(opt.chNum) + '/';
				break;
			default:
				nVal = '';
			}
			bVal = ('0' + parseInt(opt.busNum)).substr(-2);
			cmd = opt.type + nVal + 'mix/' + bVal + '/level';
			if ((fVal = fadeTo(cmd, opt)) < 0) {
				cmd = undefined;
			} else {
				arg = {
					type: 'f',
					value: fVal
				};
			}
		break;

		case 'mFad':
		case 'mFad_a':
		case 'mFad_s':
		case 'mFad_r':
			cmd = '/lr/mix/fader';
			if ((fVal = fadeTo(cmd, opt)) < 0) {
				cmd = undefined;
			} else {
				arg = {
					type: 'f',
					value: fVal
				};
			}
		break;

		case 'usbFad':
		case 'usbFad_a':
		case 'usbFad_r':
			cmd = '/rtn/aux/mix/fader';
			if ((fVal = fadeTo(cmd, opt)) < 0) {
				cmd = undefined;
			} else {
				arg = {
					type: 'f',
					value: fVal
				};
			}
		break;

		case 'solo_level':
		case 'solo_level_a':
			cmd = '/config/solo/level';
			if ((fVal = fadeTo(cmd, opt)) < 0) {
				cmd = undefined;
			} else {
				arg = {
					type: 'f',
					value: fVal
				};
			}
		break;

		case 'solosw_ch':
		case 'solosw_aux':
		case 'solosw_fxr':
		case 'solosw_bus':
		case 'solosw_fsx':
		case 'solosw_lr':
		case 'solosw_dca':
			nVal = (opt.num ? opt.num : 1);
			cmd = "/-stat/solosw/" + bx_pad2(self.soloOffset[action.action] + nVal);
			arg = {
				type: 'i',
				value: setToggle(cmd, opt.solo)
			};

		break;

		case 'solo_mute':
			cmd = '/config/solo/mute';
			arg = {
				type: 'i',
				value: setToggle(cmd, opt.set)
			};
		break;

		case 'solo_mono':
			cmd = '/config/solo/mono';
			arg = {
				type: 'i',
				value: setToggle(cmd, opt.set)
			};
		break;

		case 'solo_dim':
			cmd = '/config/solo/dim';
			arg = {
				type: 'i',
				value: setToggle(cmd, opt.set)
			};
		break;

		case 'clearsolo':
			cmd = '/-action/clearsolo';
			// needs an arg for some silly reason
			arg = {
				type: 'i',
				value: 1
			};
		break;

		case 'label':
			arg = {
				type: "s",
				value: "" + opt.lab
			};
			if (opt.type == '/ch/') {
				if (opt.num <= 9){
					nVal = ('0' + parseInt(opt.num)).substr(-2);
				}
				if (opt.num >= 10) {
					nVal = parseInt(opt.num);
				}
			}
			if (opt.type != '/ch/') {
				nVal = parseInt(opt.num);
			}
			cmd = opt.type + nVal + '/config/name';
		break;

		case 'mLabel':
			arg = {
				type: "s",
				value: "" + opt.lab
			};
			cmd = '/lr/config/name';
		break;

		case 'usbLabel':
			arg = {
				type: "s",
				value: "" + opt.lab
			};
			cmd = '/rtn/aux/config/name';
		break;

		case 'color':
			arg = {
				type: 'i',
				value: parseInt(opt.col)
			};
			if (opt.type == '/ch/') {
				if (opt.num <= 9){
					nVal = ('0' + parseInt(opt.num)).substr(-2);
				}
				if (opt.num >= 10) {
					nVal = parseInt(opt.num);
				}
			}
			if (opt.type != '/ch/') {
				nVal = parseInt(opt.num);
			}
			cmd = opt.type + nVal + '/config/color';
		break;

		case 'mColor':
			arg = {
				type: 'i',
				value: parseInt(opt.col)
			};
			cmd = '/lr/config/color';
		break;

		case 'usbColor':
			arg = {
				type: 'i',
				value: parseInt(opt.col)
			};
			cmd = '/rtn/aux/config/color';
		break;

		case 'load_snap':
			arg = {
				type: 'i',
				value: parseInt(opt.snap)
			};
			cmd = '/-snap/load';
		break;

		case 'next_snap':
			nVal = self.currentSnapshot;
			nVal = Math.min(++nVal, 64)
			arg = {
				type: 'i',
				value: nVal
			};
			cmd = '/-snap/load';
		break;

		case 'prev_snap':
			nVal = self.currentSnapshot;
			nVal = Math.max(--nVal,1);
			arg = {
				type: 'i',
				value: nVal
			};
			cmd = '/-snap/load';
		break;

		case 'save_snap':
			arg = {
				type: 'i',
				value: self.currentSnapshot
			};
			cmd = '/-snap/save';
		break;

		case 'tape':
			arg = {
				type: 'i',
				value: parseInt(opt.tFunc)
			};
			cmd = '/-stat/tape/state';
		break;
	}

	if (cmd !== undefined) {
		self.sendOSC(cmd,arg);
//		debug (cmd, arg);
	}
};

instance_skel.extendedBy(instance);
exports = module.exports = instance;