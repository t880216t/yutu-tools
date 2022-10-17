var fs = require('fs-extra')
var path = require('path');
var cp = require('child_process');
var inquirer = require('inquirer');
var npminstall = require('npminstall');
var i18n = require('./i18n');
var co = require('co');

var projectPath = path.resolve(__dirname, '../project');

function initProjectFileOrDir(srcName, descName){
    descName = descName || srcName;
    var srcFile = projectPath + '/' + srcName;
    var destFile = path.resolve(descName);
    if(fs.existsSync(destFile) === false){
        fs.copySync(srcFile, destFile);
        console.log(descName.bold+' '+__(fs.statSync(srcFile).isDirectory()?'dir_created':'file_created').green);
    }
}


function initProject(mapFiles){
    for(var key in mapFiles){
        initProjectFileOrDir(key, mapFiles[key]);
    }
}

function initConfig(){
    console.log('初始化项目'.green)
    var configPath = 'config.json';
    var configFile = path.resolve(configPath);
    var config = {
        "webdriver": {
            "host": "127.0.0.1",
            "port": "4444",
            "mainBrowser": {
                "browserId": "",
                "displayName": "chrome",
                "browserName": "chrome",
                "version": "",
                "httpProxy": "",
                "binary": ""
            },
            "syncBrowsers": []
        },
        "browserSize": "1024x768x24",
        "defaultUrl": "https://127.0.0.1",
        "vars": {},
        "serverIp": "127.0.0.1",
        "reporter": {
            "distDir": ""
        },
        "screenshots": {
            "captureAll": true
        },
        "recorder": {
            "pathAttrs": "data-id,data-name,type,data-type,role,data-role,data-value",
            "attrValueBlack": "",
            "classValueBlack": "",
            "hideBeforeExpect": ""
        }
    };
    if(!fs.existsSync(configFile)){
        fs.writeFileSync(configFile, JSON.stringify(config, null, 4));
        console.log('');
        console.log(configPath.bold+' '+__('file_saved').green);
    }

    initProject({
        'screenshots':'',
        'diffOutput':'',
        'uploadFiles':'',
    });
}

module.exports = initConfig;
