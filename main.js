const menubar = require('menubar');
const electron = require('electron');
const AutoLaunch = require('auto-launch');
const path = require('path');
const fs = require('fs');
const mkdir = require('mkdirp').sync;
const dialog = require('dialog');

const Menu = electron.Menu;
const BrowserWindow = electron.BrowserWindow;
const mb = menubar();

mb.setOption('preloadWindow', true);
mb.setOption('height', 400);
mb.setOption('width', 280);
mb.setOption('tooltip', "BOM Weather Status");

const weather = require('./weather.js');
const ipcMain = require('electron').ipcMain;

process.env.GOOGLE_API_KEY = "PUT_GOOGLE_API_KEY_HERE";

let settingsWindow;
let aboutWindow;

let appLauncher = new AutoLaunch({
    name: 'bomweatherstatus'
});

let config = {
    userLocation: [''],
    userLon: [''],
    userLat: [''],
    stationUrl: [''],
    activeLocation: 0,
    menuTextItem: 'temp',
    menuIcon: 'yes',
    updateInterval: 10,
};

//what setInterval() returns for updating weather
let updaterTimeout;

let contextMenuTemplate = [ 
    { label: 'About BOMWeatherStatus', click: () => { openAbout(); } },
    { label: 'Location and Settings', click: () => { openSettings(); } },
    { type: 'separator' },
    { label: 'Launch on Login', type: 'checkbox', checked: false, click: (item) => {
        appLauncher.isEnabled().then((enabled) => {
            if (enabled) {
                return appLauncher.disable().then(() => {
                    item.checked = false;
                });
            }
            else {
                return appLauncher.enable().then(() => {
                    item.checked = true;
                });
            }
        });
    } },
    { type: 'separator' },
    { label: 'loc1', type: 'checkbox', checked: false, click: changeActiveLocation },
    { label: 'loc2', type: 'checkbox', checked: false, click: changeActiveLocation },
    { type: 'separator' },
    { label: 'Quit BOMWeatherStatus', click: () => { mb.app.quit(); } }
];

let contextMenu = Menu.buildFromTemplate(contextMenuTemplate);

//Where the user location item starts from. Should change if new items are added above
let locationItemIndex = 5;

appLauncher.isEnabled().then((enabled) => {
    contextMenu.items[3].checked = enabled;
    /*
     * also update the template because we may reload the menu from template
     * after user modifies locations
     */
    contextMenuTemplate[3].checked = enabled;
});

function changeActiveLocation(item) {
    for (let i = 0; i < config.userLocation.length; i++) {
        contextMenu.items[locationItemIndex + i].checked = false;
        contextMenuTemplate[locationItemIndex + i].checked = false;
    }
    item.checked = true;
    item.label = "selected";
    for (let i = 0; i < config.userLocation.length; i++) {
        if (contextMenu.items[locationItemIndex + i].checked) {
            contextMenuTemplate[locationItemIndex + i].checked = true;
            config.activeLocation = i;
        }
    }

    contextMenu = Menu.buildFromTemplate(contextMenuTemplate);
    mb.tray.setContextMenu(contextMenu);

    weather.getWeather(config, (json) => {
        updateTrayTitle(json);
        saveConfig(config);
    }, null);
}

let saveConfig = (c) => {
    let dir = path.join(mb.app.getPath('userData'), 'data');
    let configFile = dir + '/config.json';

    console.log("Saving config:" + JSON.stringify(c) + " to \"" + configFile + "\"");
    try {
        fs.writeFileSync(configFile, JSON.stringify(c));
    } catch (e) {
        console.error("write config to file error:" + e);
    }
}

let loadConfig = () => {
    /* 
     * copied & modified from project: https://github.com/maxogden/monu
     * Copyright (c) 2015, Max Ogden and contributors
     */
    let dir = path.join(mb.app.getPath('userData'), 'data');
    let configFile = dir + '/config.json';
    let conf;
    let data;

    try {
        data = fs.readFileSync(configFile);
    } catch (e) {
        if (e.code === 'ENOENT') {
            mkdir(dir);
            fs.writeFileSync(configFile, fs.readFileSync(__dirname + '/config.json'));
            return loadConfig();
        } else {
            throw e;
        }
    }

    try {
        conf = JSON.parse(data.toString());
    } catch (e) {
        let code = dialog.showMessageBox({
            message: 'Invalid config file. JSON parse error',
            detail: e.stack,
            buttons: ['Reload Config', 'Exit app']
        });
        if (code === 0) {
            return loadConfig();
        } else {
            mb.app.quit();
            return;
        }
    }

    return conf;
}

let openSettings = () => {
    settingsWindow = new BrowserWindow({
        width: 400, height: 450, resizable: false,
        title: "BOM Weather Status Setting",
        autoHideMenuBar: true,
    });

    settingsWindow.webContents.once('dom-ready', () => {
        setImmediate(() => {
            settingsWindow.webContents.send('config-update', config);
        });
    });

    settingsWindow.loadURL('file://' + __dirname + '/settings.html');
    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });

}

let openAbout = () => {
    aboutWindow = new BrowserWindow({
        width: 400, height: 280, resizable: false,
        title: "About BOM Weather Status",
        autoHideMenuBar: true,
    });
    aboutWindow.loadURL('file://' + __dirname + '/about.html');
    aboutWindow.on('closed', () => {
        aboutWindow = null;
    });
}

let updateTrayTitle = (json) => {
    try {
        switch(config.menuTextItem) {
        case "press":
            mb.tray.setTitle(json.press.toString() + " hPa");
            break;
        case "wind_dir":
            mb.tray.setTitle("Wind:" + json.wind_dir.toString());
            break;
        case "wind":
            mb.tray.setTitle("W:" + json.wind_spd_kmh.toString() + "km/h");
            break;
        case "gust":
            mb.tray.setTitle("G:" + json.gust_kmh.toString() + "km/h");
            break;
        case "hum":
            mb.tray.setTitle(json.rel_hum.toString() + "%");
            break;
        case "rain":
            mb.tray.setTitle(json.rain_trace.toString() + "mm");
            break;
        case "apparent_temp":
            mb.tray.setTitle("Feels " + json.apparent_t.toString() + "°");
            break;
        case "dewpt":
            mb.tray.setTitle("Dew " + json.dewpt.toString() + "°");
            break;
        case "temp":
        default:
            mb.tray.setTitle(json.air_temp.toString() + "°");
            break;
        }
    } catch (e) {
        console.error("update menubar title error:" + e);
        mb.tray.setTitle("N/A");
    }

    if (config.menuIcon !== 'yes')
        mb.tray.setImage(null);
};

let updateLocationMenuItem = () => {
    //and set correct labels for the locations in the menu
    for (let i = 0; i < config.userLocation.length; i++) {
        contextMenuTemplate[locationItemIndex + i].label = config.userLocation[i];
        contextMenuTemplate[locationItemIndex + i].checked = false;
    }
    //check active location in the menu
    contextMenuTemplate[locationItemIndex + config.activeLocation].checked = true;
    //rebuild the context menu (MenuItem.label can't be changed dynamically)
    contextMenu = Menu.buildFromTemplate(contextMenuTemplate);
    if (process.platform === 'linux')
        mb.tray.setContextMenu(contextMenu);
}

let refreshLocation = () => {
    weather.updateLocations(config, (loc_index) => {
        //now update weather for this new location if it's active
        if (loc_index === config.activeLocation) {
            console.log("location updated, getting weather again..");
            weather.getWeather(config, updateTrayTitle, null);
        }
    }, null);
}

mb.on('ready', () => {
    mb.tray.setTitle('');
    mb.tray.on('right-click', () => {
        mb.tray.popUpContextMenu(contextMenu);
    });
});

mb.on('after-create-window', () => {
    config = loadConfig();

    if (process.platform === 'linux') {
        contextMenuTemplate.splice(0, 0, {
            label: "Open BOMWeatherStatus", click: () => {
                let p = electron.screen.getCursorScreenPoint();
                mb.setOption('x', p.x);
                mb.setOption('y', p.y);
                mb.showWindow();
            }
        });
        locationItemIndex = 6;
    }

    updateLocationMenuItem();   

    //initial weather update
    mb.window.webContents.once('dom-ready', () => {
        setImmediate(() => {
            weather.setWindow(mb.window);
            weather.getWeather(config, updateTrayTitle, refreshLocation);
        });
    });

    //update weather every "config.updateInterval" min
    if (config.updateInterval === undefined || config.updateInterval <= 0)
        config.updateInterval = 10; 
    console.log("updating weather every " + config.updateInterval + " minutes");

    updaterTimeout = setInterval(() => {
        weather.getWeather(config, updateTrayTitle, refreshLocation);
    }, config.updateInterval * 1000 * 60);
});

ipcMain.on('update-location', (event, data) => {
    config.userLocation = data; //list of string
    console.log("Updating user locations:" + config.userLocation);
    weather.updateLocations(config, (loc_index) => {
        saveConfig(config);
        //now update weather for this new location if it's active
        if (loc_index === config.activeLocation) {
            weather.getWeather(config, updateTrayTitle, null);
            settingsWindow.webContents.send('location-updated');
        }
 
        updateLocationMenuItem();   
    }, (msg) => {
        //in case of error
        dialog.showMessageBox({
            message: "Update user location failed",
            detail: msg,
            buttons: ['OK']
        });
    });
});

ipcMain.on('update-weather', (event, data) => {
    console.log('Updating weather for user location: ' + config.userLocation);
    weather.getWeather(config, updateTrayTitle, refreshLocation);
});

ipcMain.on('change-menu-title', (event, data) => {
    config.menuTextItem = data;
    console.log('Changing menubar title to: ' + config.menuTextItem);
    weather.getWeather(config, (json) => {
        updateTrayTitle(json);
        saveConfig(config);
    }, null);
});

ipcMain.on('change-menu-icon', (event, data) => {
    const icon_path = path.join(mb.getOption('dir'), 'IconTemplate.png');
    config.menuIcon = data;
    if (config.menuIcon !== 'yes') {
        mb.tray.setImage(null);
    } else {
        mb.tray.setImage(icon_path);
    }
    saveConfig(config);
});

ipcMain.on('change-update-interval', (event, data) => {
    config.updateInterval = parseInt(data);
    console.log('Changing weather update interval to ' + config.updateInterval + "minutes");
    clearInterval(updaterTimeout);
    updaterTimeout = setInterval(() => {
        weather.getWeather(config, updateTrayTitle, null);
    }, config.updateInterval * 1000 * 60);
    saveConfig(config);
});

