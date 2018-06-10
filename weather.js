const http = require('http');
const request = require('request');

let mainWindow;

const address_url = 'https://maps.googleapis.com/maps/api/geocode/json?address=';
let addressToLatLon = (address, callback, err_callback) => {
    request.get(address_url + address + "&key=" + process.env.GOOGLE_API_KEY,
                (error, response, body) => {
        if (error) {
            console.error(error);
            err_callback("Error getting response from google geocoding API:" + error);
            return;
        }
        try {
            let json = JSON.parse(body);
            let formatted_address = json.results[0].formatted_address;
            let latitude = json.results[0].geometry.location.lat;
            let longitude = json.results[0].geometry.location.lng;

            console.log(
                `Google Geocoding API => Location: ${formatted_address} -`, 
                `Latitude: ${latitude} -`, `Longitude: ${longitude}`
            );

            typeof callback === 'function' && callback(latitude, longitude);
        } catch (e) {
            console.error("google geocoding api error:" + e + "\nbody:" + body);
            err_callback("Google geocoding API error:" + e + "\nbody:" + body);
        }
    });
};


module.exports = {};

module.exports.setWindow = (window) => {
    mainWindow = window;
};

module.exports.getWeather = (config, callback, nodata_callback) => {
    let url = config.stationUrl[config.activeLocation];
    if (url === undefined || !url) {
        console.log(`Location ${config.userLocation[config.activeLocation]} error, not updating weather`);
        return;
    }
    request.get(url, (error, response, body) => {
        if (error) {
            console.error("getting bom data failed:" + error);
            return;
        }
        try {
            let json = JSON.parse(body);
            let latest = json.observations.data[0];

            //check data, at least we should have temperature
            if (latest["air_temp"] === null) {
                console.log("no data for this observation, check if we need to update location");
                typeof nodata_callback === 'function' && nodata_callback();
                return;
            }

            console.log("[" + latest.local_date_time + " " +  
                json.observations.header[0].time_zone + 
                "] weather updated from " + 
                json.observations.header[0].name);

            //add additional info for UI
            latest["observatory"] = json.observations.header[0].name;
            latest["timezone"] = json.observations.header[0].time_zone;
            latest["user_location"] = config.userLocation[config.activeLocation];
            if (typeof mainWindow !== 'undefined') {
                mainWindow.webContents.send('weather-updated', latest);
            }

            typeof callback === 'function' && callback(latest);
        } catch (e) {
            console.error("getWeather failed:" + e.stack);
        }
    });
};

module.exports.updateLocations = (config, callback, err_callback) => {
    // loop through all user locations and update
    for(let i = 0; i < config.userLocation.length; i++) {
        addressToLatLon(config.userLocation[i], (lat, lon) => {
            const query_url = "http://www.bom.gov.au/places/search/?q=";
            request.get(query_url + lat + '/' + lon, (error, response, body) => {
                if (error) {
                    console.error("BOM location " + i + " search error:" + error);
                    err_callback("BOM location " + i + " search error:" + error);
                    return;
                }

                //to catch station ID: <p class="station-id">ID: 95874</p>
                let regex = /<p class=\"station\-id\">ID:\ *([0-9\.]+)<\/p>/;
                let station_id_res = body.match(regex);
                if (!station_id_res) {
                    console.error("no station id found for location " + i);
                    config.stationUrl[i] = undefined;
                    err_callback(`Invalid location[${i}]: ${config.userLocation[i]}. Please enter a valid AU location`);
                    return;
                }

                //to catch state: <p class="station-name"><a href="/places/vic/
                regex = /<p class=\"station-name\"><a href=\"\/places\/([a-z]+)\//;
                let state_res = body.match(regex);
                if (!state_res) {
                    console.error("no station state found for location " + i);
                    err_callback(`Invalid location[${i}]: ${config.userLocation[i]}. Please enter a valid AU location`);
                    return;
                }

                //update config
                config.userLat[i] = lat;
                config.userLon[i] = lon;

                //determine final URL to weather data
                let stationId = station_id_res[1];
                // note: 60901 will update every 10 min while 60801 30min
                let productId = 60801;
                switch(state_res[1]) {
                case "vic":
                    stateCode = "V";
                    break;
                case "nt":
                    stateCode = "D";
                    break;
                case "nsw":
                    stateCode = "N";
                    break;
                case "act":
                    stateCode = "N";
                    productId = 60903;
                    break;
                case "qld":
                    stateCode = "Q";
                    break;
                case "sa":
                    stateCode = "S";
                    break;
                case "tas":
                    stateCode = "T";
                    break;
                case "wa":
                    stateCode = "W";
                    break;
                }

                //60801 by default, 60903 for ACT only, 60803 for AU-Antarctica only
                config.stationUrl[i] = `http://www.bom.gov.au/fwo/ID${stateCode}${productId}/ID${stateCode}${productId}.${stationId}.json`;
                console.log("BOM weather observation URL for location " + i + 
                    ": " + config.stationUrl[i]);

                typeof callback === 'function' && callback(i);
            });
        }, err_callback);
    }; //end-for
};

