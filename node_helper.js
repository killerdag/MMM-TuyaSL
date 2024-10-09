/* Magic Mirror
 * Node Helper: MMM-TuyaSL
 *
 * By Slamet PS/slametps@gmail.com
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const axios = require('axios');
const qs = require('qs');
const fs = require('fs');

let arrDevices = [];
let loginDataResult = { success: false };
let regionTuya;

// Funzione per mappare countryCode a regionTuya
function mapCountryToRegion(countryCode) {
  const euCountries = ['IT', 'ID', 'DE', 'FR', 'ES', 'UK', 'NL', 'BE', 'CH', 'SE', 'NO', 'DK', 'FI', 'AT', 'IE', 'PT', 'PL', 'GR'];
  const usCountries = ['US', 'CA', 'MX', 'BR'];
  const cnCountries = ['CN'];

  if (euCountries.includes(countryCode.toUpperCase())) {
    return 'eu';
  } else if (usCountries.includes(countryCode.toUpperCase())) {
    return 'us';
  } else if (cnCountries.includes(countryCode.toUpperCase())) {
    return 'cn';
  } else {
    return 'eu'; // Default
  }
}

module.exports = NodeHelper.create({
  // Subclass start method.
  start: function() {
    console.log("Starting node_helper.js for MMM-TuyaSL.");
    // Mappa countryCode a regionTuya
    const countryCode = this.config.countryCode.toUpperCase();
    regionTuya = mapCountryToRegion(countryCode);
    console.log(`Using regionTuya: ${regionTuya}`);
  },

  dump: function(v, s) {
    s = s || 1;
    let t = '';
    switch (typeof v) {
      case "object":
        t += "\n";
        for (let i in v) {
          t += Array(s).join(" ") + i + ": ";
          t += this.dump(v[i], s + 3);
        }
        break;
      default: //number, string, boolean, null, undefined
        t += v + " (" + typeof v + ")\n";
        break;
    }
    return t;
  },

  login: function (config, params) {
    const that = this;

    try {
      async function loginTuya() {
        let configAx = {
          headers: {
            "Content-type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0"
          },
          responseType: "json",
          timeout: config.timeout
        };

        let paramsAx = {
          "userName": config.userName,
          "password": config.password,
          "countryCode": config.countryCode,
          "bizType": config.bizType,
          "from": config.from
        };

        try {
          let res = await axios.post(`https://px1.tuya${regionTuya}.com/homeassistant/auth.do`, qs.stringify(paramsAx), configAx);

          if (res.status === 200) {
            // Verifica se la risposta è positiva
            if (res.data.responseStatus) {
              // Risposta non riuscita
              console.log(`ERROR: Got unsuccessful response (${res.data.errorMsg})`);
            } else {
              // Risposta riuscita
              loginDataResult = {
                "access_token": res.data.access_token,
                "refresh_token": res.data.refresh_token,
                "token_type": res.data.token_type,
                "expires_in": res.data.expires_in,
                "success": true
              }

              // Salva accessToken nel file temporaneo
              try {
                fs.writeFileSync('/tmp/mmm-tuyasl-token.txt', loginDataResult.access_token);
                console.log('DEBUG: accessToken salvato correttamente.');
              }
              catch (e) {
                console.log('ERROR: Impossibile scrivere il token nel file: ', e.stack);
              }
            }
          } else {
            // Risposta HTTP non valida
            console.log(`ERROR: HTTP response is not successful (${res.status}:${res.statusText})`);
          }
        }
        catch(e) {
          console.log('ERROR: ', e.stack);
        }

      }

      loginTuya();

    }
    catch (e) {
      console.log('ERROR: ', e.stack);
    }
  },

  search: function (config, params) {
    console.log('Getting device list...');
    // Pulisci arrDevices
    arrDevices = [];
    const that = this;

    // Ottieni accessToken salvato
    try {
      const data = fs.readFileSync('/tmp/mmm-tuyasl-token.txt', 'ascii');
      that.accessToken = data.toString().trim();
      console.log(`DEBUG: accessToken letto: ${that.accessToken}`);
    }
    catch (e) {
      console.log('ERROR: Impossibile leggere accessToken:', e.stack);
      return;
    }

    try {
      async function getDeviceList() {
        const configAx = {
          headers: {
            "Content-type": "application/json",
            "User-Agent": "Mozilla/5.0"
          },
          responseType: "json",
          timeout: config.timeout
        };

        const paramsPayload = {
          "header": {
            "name": "Discovery",
            "namespace": "discovery",
            "payloadVersion": 1
          },
          "payload": {
            "accessToken": that.accessToken
          }
        };

        try {
          const res = await axios.post(`https://px1.tuya${regionTuya}.com/homeassistant/skill`, paramsPayload, configAx);
          console.log(`DEBUG: regionTuya: ${regionTuya}`);

          if (res.data && res.data.header && res.data.header.code === 'SUCCESS') {
            try {
              res.data.payload.devices.forEach(device => {
                const deviceOnline = device.data.online === "true";
                const deviceState = device.data.state === "true" ? true : (device.data.state === "false" ? false : null);
                const deviceItem = {
                  alias: device.name,
                  type: device.dev_type,
                  online: deviceOnline,
                  on_off: deviceState
                };
                arrDevices.push(deviceItem);
              });
              console.log(`DEBUG: Number of Devices = ${arrDevices.length}`);
            }
            catch (e) {
              console.log('ERROR: Durante l\'elaborazione dei dispositivi:', e.stack);
            }
          }
          else {
            console.log(`ERROR: getDeviceList failed (${res.data.header.code})`);
            // Notifica per tentare nuovamente il login e ottenere un nuovo accessToken
            if (res.data.header.code === 'InvalidAccessTokenError') {
              that.sendSocketNotification('TUYASL_NETWORK_LOGIN_RESULT', { loginData: { success: false } });
            }
          }
        }
        catch (e) {
          console.log('ERROR: ', e.stack);
        }
      }

      getDeviceList();

    } catch (e) {
      console.log('ERROR: ', e.stack);
    }
  },

  socketNotificationReceived: function(notification, payload) {
    console.log("MMM-TuyaSL node helper received a socket notification: " + notification + " - Payload: " + JSON.stringify(payload));
    if (notification === "TUYASL_NETWORK_LOGIN") {
      this.login(payload.config, {});
      const that = this;

      function sendInfoLogin() {
        that.sendSocketNotification('TUYASL_NETWORK_LOGIN_RESULT', { loginData: loginDataResult });
      }

      setTimeout(sendInfoLogin, payload.config.timeout + 100);
    }
    else if (notification === "TUYASL_NETWORK_SEARCH") {
      this.search(payload.config, {});
      const that = this;

      function sendInfo() {
        if (arrDevices.length >= 1) {
          arrDevices.sort((a, b) => {
            const x = a.alias.toLowerCase();
            const y = b.alias.toLowerCase();
            if (x < y) return -1;
            if (x > y) return 1;
            return 0;
          });
        }
        that.sendSocketNotification('TUYASL_NETWORK_SEARCH_RESULT', { devices: arrDevices });
      }

      setTimeout(sendInfo, payload.config.timeout + 100);
    }
  },
});
