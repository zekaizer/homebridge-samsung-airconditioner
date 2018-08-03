var Service, Characteristic;
var execute = require("child_process").exec;
var response;
var waitUntil = require('wait-until');

module.exports = function(homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	Accessory = homebridge.hap.Accessory;
	//UUIDGen = homebridge.hap.uuid;
	homebridge.registerAccessory("homebridge-samsung-airconditioner", "SamsungAirconditioner", SamsungAirco);
};

function SamsungAirco(log, config) {
	this.log = log;
	this.name = config["name"];
	this.ip = config["ip"];
	this.token = config["token"];
	this.patchCert = config["patchCert"];
	this.accessoryName = config["name"];
	this.deviceId = config["id"];

	this.statusJSON = {};
	this.isValid = false;
	this.isUpdating = false;

	this.targetTemp = 26;
}

SamsungAirco.prototype = {

	execRequest: function(str, body, callback) {
		execute(str, function(error, stdout, stderr) {
			callback(error, stdout, stderr)
		})
		//return stdout;
	},
	getCachedStatus: function(callback) {
		var body;

		if(this.isValid) {
			callback();
			return;
		}

		if(this.isUpdating) {
			waitUntil(10, Infinity, function condition() {
				return (this.isUpdating == false);
			}.bind(this), function done(result) {
				// result is true on success or false if the condition was never met
				if(result) callback();
			});
		} else {
			this.isUpdating = true;

			str = 'curl -s -k -H "Content-Type: application/json" -H "Authorization: Bearer ' + this.token + '" --cert '
				+ this.patchCert + ' --insecure -X GET https://' + this.ip + ':8888/devices/' + this.deviceId;
			this.log("GET /devices/" + this.deviceId);

			this.execRequest(str, body, function(error, stdout, stderr) {
				if (error) {
				} else {
					this.statusJSON = JSON.parse(stdout);
					this.isValid = true;
					this.isUpdating = false;
					this.log("status update done!");
					setTimeout(function() {
						this.isValid = false;
						this.log("status invalid");
					}.bind(this), 100);
				}
				callback(error);
			}.bind(this));
		}
	},
	sendCommand: function(uri, data, callback) {
		var body;

		str = 'curl -X PUT -d \'' + data + '\' -v -k -H "Content-Type: application/json" -H "Authorization: Bearer '
			 + this.token + '" --cert ' + this.patchCert + ' --insecure https://' + this.ip + ':8888/devices/' + this.deviceId + uri;
		this.log("PUT /devices/" + this.deviceId + uri + " : " + data);

		this.execRequest(str, body, function(error, stdout, stderr) {
			if (error) {
				this.log("Send Command Error " + error + "! " + stdout);
				callback(new Error("Send Command Error " + error + "! " + stdout));
			} else {
				callback(null);
			}
		}.bind(this));
	},


	getServices: function() {

		//var uuid;
		//uuid = UUIDGen.generate(this.accessoryName);
		this.aircoSamsung = new Service.HeaterCooler(this.name);

		this.aircoSamsung.getCharacteristic(Characteristic.Active).on('get', this.getActive.bind(this)).on('set', this.setActive.bind(this)); //On  or Off

		this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({
				minValue: 0,
				maxValue: 100,
				minStep: 0.01
			})
			.on('get', this.getCurrentTemperature.bind(this));

		this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState).on('get', this.getTargetHeaterCoolerState.bind(this)).on('set', this.setTargetHeaterCoolerState.bind(this));

		this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
			.on('get', this.getCurrentHeaterCoolerState.bind(this));

		this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 1
			})
			.on('get', this.getCoolingThresholdTemperature.bind(this))
			.on('set', this.setCoolingThresholdTemperature.bind(this));
/*
		this.aircoSamsung.getCharacteristic(Characteristic.HeatingThresholdTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 1
			})
			.on('get', function(callback) {
				this.getCachedStatus(function(error) {
					this.aircoSamsung.setCharacteristic(Characteristic.HeatingThresholdTemperature, this.statusJSON.Device.Temperatures[0].current);
					callback(error, this.statusJSON.Device.Temperatures[0].desired);
				}.bind(this));
			}.bind(this))
			.on('set', function(temp, callback) {
				callback(null);
			}.bind(this));
*/
		this.getCachedStatus(function(error) {
			//this.log(this.statusJSON.Device);

			this.aircoSamsung.getCharacteristic(Characteristic.Active)
				.updateValue(this.statusJSON.Device.Operation.power == "On" ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
			this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(this.statusJSON.Device.Temperatures[0].desired);
		}.bind(this));

		var informationService = new Service.AccessoryInformation();

		return [informationService, this.aircoSamsung];
	},

	//services

	getCoolingThresholdTemperature: function(callback) {
		this.getCachedStatus(function() {
			this.log("희망온도: " + this.statusJSON.Device.Temperatures[0].desired);
			callback(null, this.statusJSON.Device.Temperatures[0].desired);
			this.targetTemp = this.statusJSON.Device.Temperatures[0].desired;
		}.bind(this));
	},

	setCoolingThresholdTemperature: function(temp, callback) {
		this.sendCommand("/temperatures/0", '{"desired": ' + temp + '}', function(error) {
			callback(error);
			this.targetTemp = temp;
		}.bind(this));
	},

	getCurrentTemperature: function(callback) {
		this.getCachedStatus(function() {
			curTemp = this.statusJSON.Device.Temperatures[0].current;
			this.log("현재온도: " + curTemp);
			//this.aircoSamsung.setCharacteristic(Characteristic.CurrentTemperature, curTemp);
			callback(null, curTemp);
		}.bind(this));
	},

	getActive: function(callback) {
		this.getCachedStatus(function() {
			power = this.statusJSON.Device.Operation.power;
			this.log("Power: " + power);

			if (power == "Off") {
				callback(null, Characteristic.Active.INACTIVE);
			} else if (power == "On") {
				callback(null, Characteristic.Active.ACTIVE);
			} else {
				this.log(power + "연결안됨");
				callback(new Error(power + "연결안됨"));
			}
		}.bind(this));
	},

	setActive: function(state, callback) {
		data = {'Operation' : {'power' : 'Off'}};

		if (state == Characteristic.Active.ACTIVE) {
			data = {'Operation' : {'power' : 'On'}};
		}

		this.sendCommand("", JSON.stringify(data), function(error) {
			if (state == Characteristic.Active.ACTIVE) {
				data = {'desired' : this.targetTemp};
				this.sendCommand("/temperatures/0", JSON.stringify(data), function(error) {
				}.bind(this));
			}
			callback(error);
		}.bind(this));
	},

	getCurrentHeaterCoolerState: function(callback) {
		this.getCachedStatus(function() {
			mode = this.statusJSON.Device.Mode.modes[0];
			this.log("현재 동작모드: " + mode);

			if (mode == "Cool") {
				callback(null, Characteristic.CurrentHeaterCoolerState.COOLING);
			} else if (mode == "Wind") {
				callback(null, Characteristic.CurrentHeaterCoolerState.IDLE);
			} else if (mode == "Auto") {
				callback(null, Characteristic.CurrentHeaterCoolerState.COOLING);
			} else {
				this.log(mode + "는 설정에 없는 모드 입니다");
				callback(new Error(mode + "는 설정에 없는 모드 입니다"));
			}

		}.bind(this));
	},

	getTargetHeaterCoolerState: function(callback) {
		const mapMode = {
			 'Auto' : {'Char': Characteristic.TargetHeaterCoolerState.AUTO, 'Name':'스마트쾌적모드'},
			 'Cool' : {'Char': Characteristic.TargetHeaterCoolerState.COOL, 'Name':'냉방모드'},
			 'Wind' : {'Char': Characteristic.TargetHeaterCoolerState.HEAT, 'Name':'공기청정모드'},
		};

		this.getCachedStatus(function() {
			mode = this.statusJSON.Device.Mode.modes[0];

			if(mapMode[mode]) {
				this.log("목표모드 " + mapMode[mode]['Name']);
				callback(null, mapMode[mode]['Char']);
			} else {
				this.log(mode + "는 설정에 없는 모드입니다.");
				callback(new Error(mode + "는 설정에 없는 모드입니다."));
			}
		}.bind(this));
	},

	setTargetHeaterCoolerState: function(state, callback) {
		data = {'modes':['Auto']};

		switch (state) {
			case Characteristic.TargetHeaterCoolerState.AUTO:
				this.log("스마트쾌적모드를 설정합니다")
				data['modes'] = ['Auto'];
				break;

			case Characteristic.TargetHeaterCoolerState.HEAT:
				this.log("공기청정모드로 설정합니다")
				data['modes'] = ['Wind'];
				break;
				
			case Characteristic.TargetHeaterCoolerState.COOL:
				this.log("냉방모드를 설정합니다")
				data['modes'] = ['Cool'];
				break;
		}

		this.sendCommand("/mode", JSON.stringify(data), function(error) {
			data = {'speedLevel':0};
			this.sendCommand("/wind", JSON.stringify(data), function(error) {
				callback(error);
			}.bind(this));
		}.bind(this));
	}
};
