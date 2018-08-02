var Service, Characteristic;
var exec2 = require("child_process").exec;
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
    this.setOn = true;
    this.setOff = false;

    this.statusJSON = {};
    this.isValid = false;
    this.isUpdating = false;
}

SamsungAirco.prototype = {

    execRequest: function(str, body, callback) {
        exec2(str, function(error, stdout, stderr) {
            callback(error, stdout, stderr)
        })
        //return stdout;
    },
    identify: function(callback) {
        this.log("Identify the clima!");
        callback(); // success
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

            str = 'curl -s -k -H "Content-Type: application/json" -H "Authorization: Bearer ' + this.token + '" --cert ' + this.patchCert + ' --insecure -X GET https://' + this.ip + ':8888/devices/' + this.deviceId;
            this.log(str);

            this.execRequest(str, body, function(error, stdout, stderr) {
                if (error) {
                    callback(error);
                } else {
                    this.log("status update");
                    this.statusJSON = JSON.parse(stdout);
                    this.isValid = true;
                    this.isUpdating = false;
                    setTimeout(function() {
                        this.isValid = false;
                        this.log("status invalid");
                    }.bind(this), 100);
                    this.log("status update done");

                    callback();
                }
            }.bind(this));
        }
    },
    getServices: function() {

        //var uuid;
        //uuid = UUIDGen.generate(this.accessoryName);
        this.aircoSamsung = new Service.HeaterCooler(this.name);

        this.aircoSamsung.getCharacteristic(Characteristic.Active)
            .on('get', this.getActive.bind(this)).on('set', this.setActive.bind(this)); //On  or Off

        this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({
                minValue: 0,
                maxValue: 100,
                minStep: 0.01
            })
            .on('get', this.getCurrentTemperature.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .on('get', this.getTargetHeaterCoolerState.bind(this)).on('set', this.setTargetHeaterCoolerState.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .on('get', this.getCurrentHeaterCoolerState.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({
                minValue: 16,
                maxValue: 30,
                minStep: 1
            })
            .on('get', this.getHeatingUpOrDwTemperature.bind(this))
            .on('set', this.setHeatingUpOrDwTemperature.bind(this));


        var informationService = new Service.AccessoryInformation();

        return [informationService, this.aircoSamsung];
    },

    //services

    getHeatingUpOrDwTemperature: function(callback) {
        this.getCachedStatus(function() {
            this.log("희망온도: " + this.statusJSON.Device.Temperatures[0].desired);
            callback(null, this.statusJSON.Device.Temperatures[0].desired);
        }.bind(this));
    },

    setHeatingUpOrDwTemperature: function(temp, callback) {
        var body;

        str = 'curl -X PUT -d \'{"desired": ' + temp + '}\' -v -k -H "Content-Type: application/json" -H "Authorization: Bearer ' + this.token + '" --cert ' + this.patchCert + ' --insecure https://' + this.ip + ':8888/devices/0/temperatures/0';
        this.log(str);

        this.execRequest(str, body, function(error, stdout, stderr) {
            if (error) {
                callback(error);
            } else {
                this.log(stdout);
                callback(null, temp);
                //callback();
            }
        }.bind(this));


    },

    getCurrentHeaterCoolerState: function(callback) {
        this.getCachedStatus(function() {
            mode = this.statusJSON.Device.Mode.modes[0];
            this.log("동작모드: " + mode);

            if (mode == "Cool") {
                callback(null, Characteristic.CurrentHeaterCoolerState.COOLING);
            } else if (mode == "Dry") {
                callback(null, Characteristic.CurrentHeaterCoolerState.HEATING);
            } else if (mode == "Auto") {
                callback(null, Characteristic.CurrentHeaterCoolerState.INACTIVE);
            } else
                this.log(mode + "는 설정에 없는 모드 입니다");

        }.bind(this));
    },

    getCurrentTemperature: function(callback) {
        this.getCachedStatus(function() {
            this.log("현재온도: " + this.statusJSON.Device.Temperatures[0].current);
            this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.statusJSON.Device.Temperatures[0].current);
            callback(null, this.statusJSON.Device.Temperatures[0].current); //Mettere qui ritorno di stdout? o solo callback()
        }.bind(this));
    },

    getActive: function(callback) {
        this.getCachedStatus(function() {
            this.log("Power: " + this.statusJSON.Device.Operation.power);

            if (this.statusJSON.Device.Operation.power == "Off") {
                callback(null, Characteristic.Active.INACTIVE);
            } else if (this.statusJSON.Device.Operation.power == "On") {
                this.log("연결됨");
                callback(null, Characteristic.Active.ACTIVE);
            } else {
                this.log(this.statusJSON.Device.Operation.power + "연결안됨");
            }
        }.bind(this));
    },
    setActive: function(state, callback) {
        var body;
        var token, ip, patchCert;
        token = this.token;
        ip = this.ip;
        patchCert = this.patchCert;
        deviceId = this.deviceId;

        this.log("COSA E");
        this.log(state);
        this.log(ip);
        var activeFuncion = function(state) {
            if (state == Characteristic.Active.ACTIVE) {
                str = 'curl -k -H "Content-Type: application/json" -H "Authorization: Bearer ' + token + '" --cert ' + patchCert + ' --insecure -X PUT -d \'{"Operation" : {\"power"\ : \"On"\}}\' https://' + ip + ':8888/devices/' + deviceId;
                console.log("켜짐");
            } else {
                console.log("꺼짐");
                str = 'curl -k -H "Content-Type: application/json" -H "Authorization: Bearer ' + token + '" --cert ' + patchCert + ' --insecure -X PUT -d \'{"Operation" : {\"power"\ : \"Off"\}}\' https://' + ip + ':8888/devices/' + deviceId;
            }
        }
        activeFuncion(state);
        this.log(str);

        this.execRequest(str, body, function(error, stdout, stderr) {
            if (error) {
                this.log('Power function failed', stderr);
            } else {
                this.log('Power function OK');
                //callback();
                this.log(stdout);
            }
        }.bind(this));
        callback();
    },

    setPowerState: function(powerOn, callback) {
        var body;
        var str;
        this.log("Il clima per ora è ");

        if (powerOn) {
            body = this.setOn
            this.log("켜짐");
            str = 'curl -k -H "Content-Type: application/json" -H "Authorization: Bearer ' + this.token + '" --cert ' + this.patchCert + ' --insecure -X PUT -d \'{"Operation" : {\"power"\ : \"On"\}}\' https://' + this.ip + ':8888/devices/' + this.deviceId;

        } else {
            body = this.setOff;
            this.log("꺼짐");
            str = 'curl -k -H "Content-Type: application/json" -H "Authorization: Bearer ' + this.token + '" --cert ' + this.patchCert + ' --insecure -X PUT -d \'{"Operation" : {\"power"\ : \"Off"\}}\' https://' + this.ip + ':8888/devices/' + this.deviceId;

        }
        this.log(str);

        this.execRequest(str, body, function(error, stdout, stderr) {
            if (error) {
                this.log('Power function failed', stderr);
                callback(error);
            } else {
                this.log('Power function OK');
                callback();
                this.log(stdout);
            }
        }.bind(this));
    },

    getTargetHeaterCoolerState: function(callback) {
        this.getCachedStatus(function() {
            mode = this.statusJSON.Device.Mode.modes[0];
            this.log("동작모드 alita: " + mode);

            callback();

            if (mode == "Cool") {
                this.log("냉방모드");
                Characteristic.TargetHeaterCoolerState.COOL;
            } else if (mode == "Dry") {
                this.log("공기정정모드");
                Characteristic.TargetHeaterCoolerState.HEAT;
            } else if (mode == "Auto") {
                this.log("스마트쾌적모드");
                Characteristic.TargetHeaterCoolerState.AUTO;
            } else {
                this.log(mode + "는 설정에 없는 모드입니다.");
            }

        }.bind(this));
    },
    setTargetHeaterCoolerState: function(state, callback) {

        switch (state) {

            case Characteristic.TargetHeaterCoolerState.AUTO:
                var body;
                this.log("스마트쾌적모드를 설정합니다")
                str = 'curl -X PUT -d \'{"modes": ["Auto"]}\' -v -k -H "Content-Type: application/json" -H "Authorization: Bearer ' + this.token + '" --cert ' + this.patchCert + ' --insecure https://' + this.ip + ':8888/devices/' + this.deviceId + '/mode';
                this.log(str);
                this.execRequest(str, body, function(error, stdout, stderr) {
                    if (error) {
                        this.log('Power function failed', stderr);
                        callback(error);
                    } else {
                        this.log('Power function OK');
                        callback();
                        this.log(stdout);
                    }
                }.bind(this));
                break;

            case Characteristic.TargetHeaterCoolerState.HEAT:
                var body;
                this.log("공기정정모드로 설정합니다")
                str = 'curl -X PUT -d \'{"modes": ["Wind"]}\' -v -k -H "Content-Type: application/json" -H "Authorization: Bearer ' + this.token + '" --cert ' + this.patchCert + ' --insecure https://' + this.ip + ':8888/devices/' + this.deviceId + '/mode';
                this.log(str);
                this.execRequest(str, body, function(error, stdout, stderr) {
                    if (error) {
                        this.log('Power function failed', stderr);
                        callback(error);
                    } else {
                        this.log('Power function OK');
                        callback();
                        this.log(stdout);
                    }
                }.bind(this));
                break;
                
            case Characteristic.TargetHeaterCoolerState.COOL:
                var body;
                this.log("냉방모드를 설정합니다")
                str = 'curl -X PUT -d \'{"modes": ["CoolClean"]}\' -v -k -H "Content-Type: application/json" -H "Authorization: Bearer ' + this.token + '" --cert ' + this.patchCert + ' --insecure https://' + this.ip + ':8888/devices/' + this.deviceId + '/mode';
                this.log(str);
                this.execRequest(str, body, function(error, stdout, stderr) {
                    if (error) {
                        this.log('Power function failed', stderr);
                        callback(error);
                    } else {
                        this.log('Power function OK');
                        callback();
                        this.log(stdout);
                    }
                }.bind(this));
                break;
        }
    }
};
