var path = require('path');
var fs = require('fs');
var os = require('os');
var http = require('http');
var url = require('url');
var cp = require('child_process');
var inquirer = require('inquirer');
var async = require('async');
var co = require('co');
var chai = require("chai");
const uuidv4 = require('uuid/v4');
var should = chai.should();
var JWebDriver = require('mwebdriver');
chai.use(JWebDriver.chaiSupportChainPromise);
const { remote } = require('webdriverio');
const mBrowser = require('./browser')
var chromedriver = require('chromedriver');
const $ = require('jquery');
const resemble = require('resemblejs-node');
resemble.outputSettings({
    errorType: 'flatDifferenceIntensity'
});

var WebSocketServer = require('websocket').server;
var i18n = require('./i18n');
var colors = require('colors');
var detectPort = require('detect-port');
const { getJavaTemplateContent, getArrRawCmdsTarget } = require('./builder/java');

var symbols = {
  ok: '✓',
  err: '✖'
};
var recorderBrowserTimeout = 1000;
var checkerBrowserTimeout = 0;
if (process.platform === 'win32') {
  symbols.ok = '\u221A';
  symbols.err = '\u00D7';
  recorderBrowserTimeout = 0;
  checkerBrowserTimeout = 1000;
}

var defaultOpenChecker = true;
var defaultBrowserSize = '1024x768';

var wsConnection;

var rootPath = getRootPath();
var serverAddress = getIPAddress();
var pkg = require('../package.json');

var browserNameToDriver = {
    'yandex': 'chrome',
    'qq': 'chrome',
    'chrome': 'chrome',
    'firefox': 'firefox',
    'MicrosoftEdge': 'MicrosoftEdge',
    'opera': 'opera',
    'internet explorer': 'internet explorer',
}

async function startRecorder(options){
    var locale = options.locale || 'zh-cn';
    var cmdFilename = options.cmdFilename;
    var mobile = options.mobile;
    var debug = options.debug;
    var raw = options.raw;
    var browserScreen = options.browserSize || '';
    var defaultUrl = options.defaultUrl || '';
    var httpProxy = options.httpProxy || '';
    var browserSyncSize = {height: '', width: ''}
    var syncCheckBrowserDrivers = [];

    var wdproxy = process.env['wdproxy'] || '';
    if(locale){
        i18n.setLocale(locale);
    }

    var configPath = 'config.json';
    var configFile = path.resolve(rootPath + '/' + configPath);
    var configJson = {};
    if (fs.existsSync(configFile)) {
        var content = fs.readFileSync(configFile).toString();
        try {
            configJson = JSON.parse(content);
        }
        catch (e) {
            console.log(configPath.bold + ' ' + __('json_parse_failed').red, e);
            process.exit(1);
        }
    }
    else {
        console.log(configPath.bold + ' ' + __('file_missed').red);
        process.exit(1);
    }
    if(!configJson.webdriver){
        console.log(__('please_reinit').red);
        process.exit(1);
    }
    var recorderConfig = configJson.recorder || {};
    var pathAttrs = recorderConfig.pathAttrs;
    if(pathAttrs){
        pathAttrs = pathAttrs.replace(/^\s+|\s+$/g, '');
        pathAttrs = pathAttrs.split(/\s*,\s*/).map(function(name){
            return {
                name: name,
                on: true
            };
        });
        pathAttrs.unshift({
            name: 'value',
            on: true
        });
        pathAttrs.unshift({
            name: 'name',
            on: true
        });
        pathAttrs.unshift({
            name: 'text',
            on: true
        });
        pathAttrs.unshift({
            name: 'id',
            on: true
        });
    }
    var attrValueBlack = recorderConfig.attrValueBlack;
    var classValueBlack = recorderConfig.classValueBlack;
    var hideBeforeExpect = recorderConfig.hideBeforeExpect;
    var recorderFirst = recorderConfig.recorderFirst
    // 用来确定录制窗口和校验窗口的打开顺序，用来解决某些特殊场景下，窗口显示上面顺序问题
    if(recorderFirst !== undefined){
        recorderBrowserTimeout = recorderFirst ? 0 : 1000;
        checkerBrowserTimeout = recorderFirst ? 1000 : 0;
    }
    var testVars = configJson.vars;
    var isConfigEdited = false;
    var hostsPath = 'hosts';
    var hostsFile = path.resolve(rootPath + '/' + hostsPath);
    var hosts = '';
    if(fs.existsSync(hostsFile)){
        hosts = fs.readFileSync(hostsFile).toString();
    }
    // read spec list
    var commonSpecRelPath = 'commons/';
    var commonSpecPath = rootPath + '/' + commonSpecRelPath;
    if(fs.existsSync(commonSpecPath) == false || fs.statSync(commonSpecPath).isDirectory() === false){
        commonSpecRelPath = '';
        commonSpecPath = rootPath;
    }
    var dirList = fs.readdirSync(commonSpecPath);
    var specLists = [];
    dirList.forEach(function(item){
        if(/.*\.js$/.test(item)){
            specLists.push(commonSpecRelPath + item);
        }
    });

    var wdPort = 4444;
    if(fs.existsSync(chromedriver.path) && configJson.serverIp && configJson.serverIp === '127.0.0.1'){
        // 启动本地浏览器
        await startLocalDriver(wdPort)
    }
    console.log('? '.green+__('open_checker_browser').white.bold + ' ' + (defaultOpenChecker?'Yes':'No').cyan);
    console.log('? '.green+__('browser_size').white.bold + ' ' + defaultBrowserSize.cyan);

    var fileName = cmdFilename;
    var testFile = path.resolve(fileName);
    fileName = path.relative(rootPath, testFile).replace(/\\/g,'/');
    var specName = fileName.replace(/\.js$/,'');
    var caseName = specName + ' : chrome';

    var continueRecord = false;
    var openChecker = defaultOpenChecker;
    var browserSize = defaultBrowserSize;

    var match = browserSize.match(/^(\d+)\s*[x, ]\s*(\d+)$/);
    if(match){
        browserSize = [ parseInt(match[1], 10), parseInt(match[2], 10)];
    }
    else{
        browserSize = null;
    }
    var mobileAppPath = '';
    var mobilePlatform = '';
    var arrTestCodes = [];
    var recorderBrowser, checkerBrowser, recorderMobileApp;
    var lastWindowId = 0;
    var lastFrameId = null;
    var lastTestTitle = '';
    var arrLastTestCodes = [];
    var arrRawCmds = [];
    var allCaseCount = 0;
    var failedCaseCount = 0;
    var isModuleLoading = false;
    var arrSendKeys = [];
    var lastCmdInfo0 = null;
    var lastCmdInfo1 = null;
    var lastCmdInfo2 = null;
    var dblClickFilterTimer = null;
    var cmdQueue = async.priorityQueue(function(cmdInfo, next) {
        if(isModuleLoading){
            return next();
        }
        var window = cmdInfo.window;
        var frame = cmdInfo.frame;
        var cmd = cmdInfo.cmd;
        var data = cmdInfo.data;
        let syncActionId = uuidv4();
        let casePath = path.dirname(caseName);
        let syncDiffBasePath = rootPath + '/diffbase/' + casePath + '/'+ 'sync'
        if (data && data.type === 'fulldiff'){
            data.type = 'imgdiff'
            data.params = ['']
        }

        if(cmd === 'end'){
            return next();
        }
        var arrTasks = [];
        arrTasks.push(function(callback){
            function doNext(browser){
                const {browserName, browserVersion, sessionId} = browser
                saveTestCode(true, '',browserName, browserVersion, sessionId);
            }
            function catchError(error, browser){
                const {browserName, browserVersion, sessionId} = browser
                saveTestCode(false, error, browserName, browserVersion, sessionId);
            }
            if(window !== lastWindowId){
                lastWindowId = window;
                lastFrameId = null;
                pushTestCode('switchWindow', '', window, 'await driver.sleep(500).switchWindow('+window+');')
                syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.switchWindow(window).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                callback();
            }
            else{
                callback();
            }
        });
        arrTasks.push(function(callback){
            function doNext(browser){
                const {browserName, browserVersion, sessionId} = browser
                saveTestCode(true, '',browserName, browserVersion, sessionId);
            }
            function catchError(error, browser){
                const {browserName, browserVersion, sessionId} = browser
                saveTestCode(false, error, browserName, browserVersion, sessionId);
            }
            if(frame !== lastFrameId){
                lastFrameId = frame;
                var arrCodes = [];
                if(frame !== null){
                    arrCodes.push('await driver.switchFrame(null)');
                    arrCodes.push('       .wait(\''+frame+'\', 30000).then(function(element){');
                    arrCodes.push('           return this.switchFrame(element).wait(\'body\');');
                    arrCodes.push('       });');
                }
                else{
                    arrCodes.push('await driver.switchFrame(null);');
                }
                pushTestCode('switchFrame', '', frame, arrCodes);
                syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.switchToFrame(frame).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                callback();
            }
            else{
                callback();
            }

        });
        arrTasks.push(async function(callback){
            function doNext(browser){
                const {browserName, browserVersion, sessionId} = browser
                saveTestCode(true, '',browserName, browserVersion, sessionId, syncActionId, `${syncDiffBasePath}/diff_${syncActionId}_${sessionId}.png`);
            }
            function catchError(error, browser){
                const {browserName, browserVersion, sessionId} = browser
                saveTestCode(false, error, browserName, browserVersion, sessionId, syncActionId, `${syncDiffBasePath}/diff_${syncActionId}_${sessionId}.png`);
            }
            var arrCodes = [];
            var reDomRequire = /^(val|text|displayed|enabled|selected|attr|css|count|imgdiff)$/;
            var reParamRequire = /^(attr|css|cookie|localStorage|sessionStorage|alert)$/;
            switch(cmd){
                case 'url':
                    pushTestCode('url', '', data, 'await driver.url(_(\`'+escapeStr(data)+'\`));');
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.url(getVarStr(eval('\`'+data+'\`'))).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'closeWindow':
                    pushTestCode('closeWindow', '', '', 'await driver.closeWindow();');
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.closeCurrentWindow().then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'sleep':
                    pushTestCode('sleep', '', data, 'await driver.sleep('+data+');');
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.sleep(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'waitBody':
                    arrCodes = [];
                    arrCodes.push('await driver.sleep(500).wait(\'body\', 30000).html().then(function(code){');
                    arrCodes.push('    isPageError(code).should.be.false;');
                    arrCodes.push('});');
                    pushTestCode('waitBody', '', '', arrCodes);
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser =>
                        browser?.sessionId&&browser.$('body')
                            .waitForExist({timeout: 10000})
                            .then(() => doNext(browser))
                            .catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'eval':
                    pushTestCode('eval', '', data.replace(/\n/g, ' \\n '), 'await driver.eval(_(\''+escapeStr(data)+'\'));');
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.execute(getVarStr(data)).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'mouseMove':
                    arrCodes = [];
                    arrCodes.push('await driver.sleep(300).wait(\''+escapeStr(data.path)+'\', 30000)');
                    arrCodes.push('       .sleep(300).mouseMove('+(data.x ? data.x + ', ' + data.y : '')+');');
                    pushTestCode('mouseMove', data.text, data.path+(data.x !== undefined?', '+data.x+', '+data.y:''), arrCodes);
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.mouseMove(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'mouseDown':
                    arrCodes = [];
                    arrCodes.push('await driver.sleep(300).wait(\''+escapeStr(data.path)+'\', 30000)');
                    arrCodes.push('       .sleep(300).mouseMove('+data.x+', '+data.y+').mouseDown('+data.button+');');
                    pushTestCode('mouseDown', data.text, data.path + ', ' + data.x + ', ' + data.y + ', ' + data.button, arrCodes);
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.mouseDown(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'mouseUp':
                    arrCodes = [];
                    arrCodes.push('await driver.sleep(300).wait(\''+escapeStr(data.path)+'\', 30000)');
                    arrCodes.push('       .sleep(300).mouseMove('+data.x+', '+data.y+').mouseMove('+data.x+', '+data.y+').mouseUp('+data.button+');');
                    pushTestCode('mouseUp', data.text, data.path + ', ' + data.x + ', ' + data.y + ', ' + data.button, arrCodes);
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.mouseUp(data.button).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'click':
                    arrCodes = [];
                    var option = data.option;
                    arrCodes.push('await driver.sleep(300).wait(\''+escapeStr(data.path)+'\', '+(option?'5000':'30000')+')');
                    arrCodes.push('       .sleep(300).mouseMove('+data.x+', '+data.y+').click('+data.button+')'+(option?'.catch(catchError)':'')+';');
                    pushTestCode(option?'optionClick':'click', data.text, data.path + ', ' + data.x + ', ' + data.y + ', ' + data.button, arrCodes);
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.waitClick(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'touchClick':
                    arrCodes = [];
                    arrCodes.push('await driver.sleep(300).wait(\''+escapeStr(data.path)+'\', 30000)');
                    arrCodes.push('       .sleep(300).touchClick();');
                    pushTestCode('touchClick', data.text, data.path, arrCodes);
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.waitClick(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'dblClick':
                    arrCodes = [];
                    arrCodes.push('await driver.sleep(300).wait(\''+escapeStr(data.path)+'\', 30000)');
                    arrCodes.push('       .sleep(300).mouseMove('+data.x+', '+data.y+').click(0).click(0);');
                    pushTestCode('dblClick', data.text, data.path + ', ' + data.x + ', ' + data.y + ', ' + data.button, arrCodes);
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.$(data.path).doubleClick().then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'sendKeys':
                    pushTestCode('sendKeys', '', data.keys, 'await driver.sendKeys(\''+escapeStr(data.keys)+'\');');
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.sendKeys(data.keys).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'keyDown':
                    pushTestCode('keyDown', '', data.character, 'await driver.keyDown(\''+escapeStr(data.character)+'\');');
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.sendKeys(data.character).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'keyUp':
                    pushTestCode('keyUp', '', data.character, 'await driver.keyUp(\''+escapeStr(data.character)+'\');');
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.sendKeys(data.character).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'scrollTo':
                    pushTestCode('scrollTo', '', data.x + ', ' + data.y, 'await driver.scrollTo('+data.x+', '+data.y+');');
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser?.sessionId&&browser.scrollTo(data.x, data.y).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'scrollElementTo':
                    arrCodes = [];
                    arrCodes.push('await driver.sleep(300).wait(\''+escapeStr(data.path)+'\', 30000)');
                    arrCodes.push('       .sleep(300).scrollElementTo('+ data.x + ', ' + data.y +');');
                    pushTestCode('scrollElementTo', data.text, data.path+(data.x !== undefined?', '+data.x+', '+data.y:''), arrCodes);
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.scrollElementTo(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'select':
                    arrCodes = [];
                    arrCodes.push('await driver.sleep(300).wait(\''+escapeStr(data.path)+'\', 30000)');
                    arrCodes.push('       .sleep(300).select({');
                    arrCodes.push('           type: \''+data.type+'\',');
                    arrCodes.push('           value: \''+data.value+'\'');
                    arrCodes.push('       });');
                    pushTestCode('select', data.text, data.path + ', ' + data.type + ', ' + data.value, arrCodes);
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.$(data.path).selectByAttribute(data.type, data.value).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'acceptAlert':
                    pushTestCode('acceptAlert', '', '', 'await driver.acceptAlert();');
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.acceptAlert().then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'dismissAlert':
                    pushTestCode('dismissAlert', '', '', 'await driver.dismissAlert();');
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.dismissAlert().then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'setAlert':
                    pushTestCode('setAlert', '', data.text, 'await driver.setAlert("'+data.text+'");');
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.sendAlertText(data.text).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'uploadFile':
                    arrCodes = [];
                    arrCodes.push('await driver.sleep(300).wait(\''+escapeStr(data.path)+'\', {timeout: 30000, displayed: false})');
                    arrCodes.push('       .sleep(300).uploadFile(rootPath+\'/uploadfiles/'+data.filename+'\');');
                    pushTestCode('uploadFile', data.text, data.path + ', ' + data.filename, arrCodes);
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => browser.upload(data, rootPath+'/uploadfiles/'+data.filename).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                // 添加断言
                case 'expect':
                    var sleepTime = data.sleep;
                    var expectType = data.type;
                    var expectParams = data.params;
                    var expectCompare = data.compare;
                    var expectTo = data.to;
                    var codeExpectTo = expectTo.replace(/"/g, '\\"').replace(/\n/g, '\\n');

                    arrCodes = [];
                    if(expectType === 'count'){
                        arrCodes.push('await driver.sleep('+sleepTime+').wait(\''+escapeStr(expectParams[0])+'\', {timeout: 1000, noerror: true})');
                        arrCodes.push('    .then(function(elements){');
                        arrCodes.push('        return elements.length;');
                        arrCodes.push('    })');
                    }
                    else if(expectType === 'imgdiff'){
                        arrCodes.push("let self = this;");
                        arrCodes.push("let imgBasePath = self.diffbasePath + '/' + self.caseName + '_' + self.stepId + '.png';");
                        arrCodes.push("let imgNewPath = self.screenshotPath + '/' + self.caseName + '_' + self.stepId + '_new.png';");
                        arrCodes.push("let imgDiffPath = self.screenshotPath + '/' + self.caseName + '_' + self.stepId + '_diff.png';");
                        arrCodes.push("let elemshot = await driver.sleep(300).getScreenshot({");
                        arrCodes.push("    elem: '"+escapeStr(expectParams[0])+"',");
                        arrCodes.push("    filename: imgNewPath");
                        arrCodes.push("});");
                        arrCodes.push("elemshot = new Buffer(elemshot, 'base64');");
                        arrCodes.push("if(!fs.existsSync(imgBasePath) || process.env['npm_config_rebuilddiff']){");
                        arrCodes.push("    fs.writeFileSync(imgBasePath, elemshot);");
                        arrCodes.push("}");
                        arrCodes.push("let diff = resemble(elemshot).compareTo(imgBasePath).ignoreColors();");
                        arrCodes.push("let diffResult = await new Promise((resolve) => diff.onComplete(resolve));");
                        arrCodes.push("diffResult.getDiffImage().pack().pipe(fs.createWriteStream(imgDiffPath));");
                        arrCodes.push("diffResult.rawMisMatchPercentage");
                    }
                    else{
                        if(reDomRequire.test(expectType)){
                            arrCodes.push('await driver.sleep('+sleepTime+').wait(\''+escapeStr(expectParams[0])+'\', 30000)');
                        }
                        else{
                            arrCodes.push('await driver');
                        }
                        switch(expectType){
                            case 'val':
                                arrCodes.push('    .val()');
                                break;
                            case 'text':
                                arrCodes.push('    .text()');
                                break;
                            case 'displayed':
                                arrCodes.push('    .displayed()');
                                break;
                            case 'enabled':
                                arrCodes.push('    .enabled()');
                                break;
                            case 'selected':
                                arrCodes.push('    .selected()');
                                break;
                            case 'attr':
                                arrCodes.push('    .attr(\''+escapeStr(expectParams[1])+'\')');
                                break;
                            case 'css':
                                arrCodes.push('    .css(\''+escapeStr(expectParams[1])+'\')');
                                break;
                            case 'url':
                                arrCodes.push('    .url()');
                                break;
                            case 'title':
                                arrCodes.push('    .title()');
                                break;
                            case 'cookie':
                                arrCodes.push('    .cookie(\''+escapeStr(expectParams[0])+'\')');
                                break;
                            case 'localStorage':
                                arrCodes.push('    .localStorage(\''+escapeStr(expectParams[0])+'\')');
                                break;
                            case 'sessionStorage':
                                arrCodes.push('    .sessionStorage(\''+escapeStr(expectParams[0])+'\')');
                                break;
                            case 'alert':
                                arrCodes.push('    .getAlert()');
                                break;
                            case 'jscode':
                                arrCodes.push('    .eval(\''+escapeStr(expectParams[0])+'\')');
                                break;
                        }
                        arrCodes.push('    .should.not.be.a(\'error\')');
                    }
                    switch(expectCompare){
                        case 'equal':
                            arrCodes.push('    .should.equal(_('+(/^(true|false)$/.test(codeExpectTo)?codeExpectTo:'\`'+escapeStr(codeExpectTo)+'\`')+'));');
                            break;
                        case 'notEqual':
                            arrCodes.push('    .should.not.equal(_('+(/^(true|false)$/.test(codeExpectTo)?codeExpectTo:'\`'+escapeStr(codeExpectTo)+'\`')+'));');
                            break;
                        case 'contain':
                            arrCodes.push('    .should.contain(_(\`'+escapeStr(codeExpectTo)+'\`));');
                            break;
                        case 'notContain':
                            arrCodes.push('    .should.not.contain(_(\`'+escapeStr(codeExpectTo)+'\`));');
                            break;
                        case 'above':
                            arrCodes.push('    .should.above('+codeExpectTo+');');
                            break;
                        case 'below':
                            arrCodes.push('    .should.below('+codeExpectTo+');');
                            break;
                        case 'match':
                            arrCodes.push('    .should.match('+codeExpectTo+');');
                            break;
                        case 'notMatch':
                            arrCodes.push('    .should.not.match('+codeExpectTo+');');
                            break;
                    }
                    pushTestCode('expect', '', expectType + ', ' + String(expectParams) + ', ' + expectCompare + ', ' + expectTo, arrCodes);
                    syncCheckBrowserDrivers && syncCheckBrowserDrivers.forEach(browser => co(function*(){
                        var element, value;
                        if(expectType === 'count'){
                            value = yield browser.findElements(expectParams[0]).length;
                        }
                        else if(expectType === 'imgdiff'){
                            let syncMainImg = '';
                            let checkImg = '';
                            const syncMainImgName = `${syncActionId}_main.png`
                            const checkImgName = `${syncActionId}_${browser.sessionId}.png`

                            syncMainImg = yield getImage(caseName, recorderBrowser, escapeStr(expectParams[0]), syncMainImgName, true )
                            checkImg = yield getImage(caseName, browser, escapeStr(expectParams[0]), checkImgName)

                            if (checkImg && syncMainImg){
                                syncMainImg = Buffer.from(syncMainImg, 'base64');
                                checkImg = Buffer.from(checkImg, 'base64');

                                const imgDiffPath = `${syncDiffBasePath}/diff_${checkImgName}`

                                let diff = resemble(checkImg).compareTo(syncMainImg).ignoreColors();
                                let diffResult = yield new Promise((resolve) => diff.onComplete(resolve));

                                value = diffResult.rawMisMatchPercentage;

                                diffResult.getDiffImage().pack().pipe(fs.createWriteStream(imgDiffPath));
                                const sendData = {
                                    sessionId: browser.sessionId,
                                    syncActionId: syncActionId,
                                    imgData: diffResult.getDiffImageAsJPEG().toString('base64')
                                }
                                sendWsMessage('getDiffResult', sendData);
                            }else {
                                value = 99; // 获取截图异常失败
                            }
                        }
                        else{
                            if(reDomRequire.test(expectType)){
                                element = yield browser.$(expectParams[0]);
                            }
                            switch(expectType){
                                case 'val':
                                    value = yield element.getValue();
                                    break;
                                case 'text':
                                    value = yield element.getText();
                                    break;
                                case 'displayed':
                                    value = yield element.isDisplayed();
                                    break;
                                case 'enabled':
                                    value = yield element.isEnabled();
                                    break;
                                case 'selected':
                                    value = yield element.isSelected();
                                    break;
                                case 'attr':
                                    value = yield element.getAttribute(expectParams[1]);
                                    break;
                                case 'css':
                                    value = yield element.getCSSProperty(expectParams[1]);
                                    break;
                                case 'url':
                                    value = yield browser.getUrl();
                                    break;
                                case 'title':
                                    value = yield browser.getTitle();
                                    break;
                                case 'cookie':
                                    value = yield browser.getCookies(expectParams[0]);
                                    break;
                                case 'alert':
                                    value = yield browser.getAlertText();
                                    break;
                                case 'jscode':
                                    value = yield browser.executeAsync(expectParams[0]);
                                    break;
                                case 'localStorage':
                                    value = yield browser.localStorage(expectParams[0]); //不支持
                                    break;
                                case 'sessionStorage':
                                    value = yield browser.sessionStorage(expectParams[0]); //不支持
                                    break;
                            }
                            value.should.not.be.a('error');
                        }
                        switch(expectCompare){
                            case 'equal':
                                expectTo = /^(true|false)$/.test(expectTo)?eval(expectTo):eval('\`'+expectTo+'\`');
                                value.should.equal(getVarStr(expectTo));
                                break;
                            case 'notEqual':
                                expectTo = /^(true|false)$/.test(expectTo)?eval(expectTo):eval('\`'+expectTo+'\`');
                                value.should.not.equal(getVarStr(expectTo));
                                break;
                            case 'contain':
                                value.should.contain(getVarStr(eval('\`'+expectTo+'\`')));
                                break;
                            case 'notContain':
                                value.should.not.contain(getVarStr(eval('\`'+expectTo+'\`')));
                                break;
                            case 'above':
                                value.should.above(Number(expectTo));
                                break;
                            case 'below':
                                value.should.below(Number(expectTo));
                                break;
                            case 'match':
                                value.should.match(eval(expectTo));
                                break;
                            case 'notMatch':
                                value.should.not.match(eval(expectTo));
                                break;
                        }
                    }).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser))
                    break;
                // 插入用例
                case 'module':
                    var moduleName = /[\/\\]/.test(data) ? data : commonSpecRelPath + data;
                    loadModule(moduleName, function(error){
                        if(error !== null){
                            catchError(error);
                        }
                        else{
                            console.log('  module'.cyan+': ', moduleName);
                            arrTestCodes.push('callSpec(\''+escapeStr(moduleName)+'\');\r\n');
                            doNext();
                        }
                    });
                    break;
            }
            callback();
        });
        async.series(arrTasks, function(){
            next();
        });
    }, 1);
    var recorderConfig = {
        version: pkg.version,
        pathAttrs : pathAttrs,
        attrValueBlack: attrValueBlack,
        classValueBlack: classValueBlack,
        hideBeforeExpect: hideBeforeExpect,
        mobilePlatform: mobilePlatform,
        testVars: testVars,
        specLists: specLists,
        wdproxy: wdproxy,
        i18n: __('chrome')
    };
    startRecorderServer(recorderConfig, onReady, onCommand, onEnd);
    function onReady(serverAddress, serverPort){
        var wdPacUrl = wdproxy ? 'http://'+ serverAddress + ':'+serverPort+'/proxy.pac' : '';
        // recorder browser
        setTimeout(function(){
            createBrowser({
                wdPort: wdPort,
                hosts: hosts,
                wdPacUrl: wdPacUrl,
                isRecorder: true,
                debug: debug,
                browserName: configJson.webdriver.mainBrowser.browserName,
                version: configJson.webdriver.mainBrowser.version,
                browserSize: browserScreen || browserSize,
                httpProxy: httpProxy,
            }, async function(browser){
                try {
                    await browser.maximizeWindow();
                } catch (e) {
                    console.log(e);
                }
                const extensionUrl = `chrome-extension://${debug ? 'cnjonjkencgodgmehddbjaiobcdmjije' : 'njkfhfdkecbpjlnfmminhmdcakopmcnc'}/${mobile?'mobile':'start'}.html?port=${serverPort}&ip=${serverAddress}&defaultUrl=${encodeURIComponent(defaultUrl)}`;
                await browser.url(extensionUrl);
                await browser.execute('document.title="'+__('recorder_browser_title')+' - UIRecorder"');
                console.log(`${__('recorder_browser_opened')} ${browser?.sessionId}`.green);
                console.log(`consoleParams:{"sessionId": "${browser?.sessionId}", "type": "main"}`);
                recorderBrowser = browser;
                checkAllReady();
                // for (var i=0;i<900;i++){
                //     if(recorderBrowser){
                //         try{
                //             await recorderBrowser.sleep(2000)
                //                 .then(driver=>{
                //                     driver.getWindowSize()
                //                         .then(ret => {
                //                             if (ret && ret !== browserSyncSize){
                //                                 browserSyncSize = ret
                //                             }
                //                         })
                //                 })
                //         }catch (e) {
                //             console.log(e);
                //         }
                //     }
                //     else{
                //         break;
                //     }
                // }
            });
        }, recorderBrowserTimeout);
        if(openChecker){
            // open checker browsers
            configJson.webdriver?.syncBrowsers && configJson.webdriver?.syncBrowsers.map(browserInfo => {
                setTimeout(function(){
                    createBrowser({
                        wdPort: wdPort,
                        hosts: hosts,
                        wdPacUrl: wdPacUrl,
                        isRecorder: false,
                        browserName: browserInfo.browserName,
                        version: browserInfo.version,
                        browserSize: browserScreen || browserSize,
                        httpProxy: httpProxy,
                    }, async function(browser){
                        try {
                            await browser.maximizeWindow();
                        } catch (e) {
                            console.log(e);
                        }
                        await browser.execute('document.title="'+__('checker_browser_title')+' - UIRecorder";');
                        console.log(`${__('checker_browser_opened')} ${browser?.sessionId}`.green);
                        console.log(`consoleParams:{"sessionId": "${browser?.sessionId}", "type": "sync", "browserInfo": "${browserInfo.browserName}:${browserInfo.version}"}`);
                        console.log('');
                        checkerBrowser = browser;
                        syncCheckBrowserDrivers.push(browser)
                        checkAllReady();
                        // for(var i=0;i<900;i++){
                        //     if(checkerBrowser){
                        //         try{
                        //             await checkerBrowser.sleep(2000)
                        //                 .then(driver=>{
                        //                     driver.getWindowSize()
                        //                         .then(ret => {
                        //                             if (ret && browserSyncSize.width && browserSyncSize.height){
                        //                                 if ((ret.width !== browserSyncSize.width) || (ret.height !== browserSyncSize.height)){
                        //                                     driver.setWindowRect(null, null, browserSyncSize.width, browserSyncSize.height);
                        //                                 }
                        //                             }
                        //                         })
                        //                 })
                        //         }catch (e) {
                        //             console.log(e);
                        //         }
                        //     }
                        //     else{
                        //         break;
                        //     }
                        // }
                    });
                }, checkerBrowserTimeout);
            })
            console.log('------------------------------------------------------------------'.green);
            console.log('');
        }
    }
    function onCommand(cmdInfo){
        // 合并命令流
        function sendKeysFilter(cmdInfo){
            // 合并连续的sendKeys
            var cmd = cmdInfo.cmd;
            var data = cmdInfo.data;
            if(!mobile && cmd === 'sendKeys'){
                arrSendKeys.push(data.keys);
            }
            else{
                if(arrSendKeys.length > 0){
                    // 满足条件，进行合并
                    clickFilter({
                        window: lastCmdInfo0.window,
                        frame: lastCmdInfo0.frame,
                        cmd: 'sendKeys',
                        data: {
                            keys: arrSendKeys.join('')
                        }
                    });
                    arrSendKeys = [];
                }
                clickFilter(cmdInfo);
            }
            lastCmdInfo0 = cmdInfo;
        }
        function clickFilter(cmdInfo){
            // 合并为click，增加兼容性 (mouseDown不支持button参数)
            var cmd = cmdInfo.cmd;
            var data = cmdInfo.data;
            if(lastCmdInfo1 && lastCmdInfo1.cmd === 'mouseDown'){
                var lastCmdData = lastCmdInfo1.data;
                if(cmd === 'mouseUp' &&
                    cmdInfo.window === lastCmdInfo1.window &&
                    cmdInfo.frame === lastCmdInfo1.frame &&
                    lastCmdData.path === data.path &&
                    Math.abs(lastCmdData.x - data.x) < 20 &&
                    Math.abs(lastCmdData.y - data.y) < 20
                ){
                    // 条件满足，合并为click
                    cmdInfo = {
                        window: cmdInfo.window,
                        frame: cmdInfo.frame,
                        cmd: 'click',
                        data: data,
                        text: cmdInfo.text
                    };
                }
                else{
                    // 不需要合并，恢复之前旧的mouseDown
                    dblClickFilter(lastCmdInfo1);
                }
            }
            if(cmdInfo.cmd !== 'mouseDown'){
                // mouseDown 缓存到下一次，确认是否需要合并click，非mouseDown立即执行
                dblClickFilter(cmdInfo);
            }
            lastCmdInfo1 = cmdInfo;
        }
        function dblClickFilter(cmdInfo){
            // 合并为dblClick，增加兼容性, 某些浏览器不支持连续的两次click
            var cmd = cmdInfo.cmd;
            var data = cmdInfo.data;
            if(lastCmdInfo2 && lastCmdInfo2.cmd === 'click'){
                var lastCmdData = lastCmdInfo2.data;
                clearTimeout(dblClickFilterTimer);
                if(cmd === 'click' &&
                    cmdInfo.window === lastCmdInfo2.window &&
                    cmdInfo.frame === lastCmdInfo2.frame &&
                    lastCmdData.path === data.path &&
                    (lastCmdData.x == data.x || Math.abs(lastCmdData.x - data.x) < 20) &&
                    (lastCmdData.y == data.y || Math.abs(lastCmdData.y - data.y) < 20)
                ){
                    // 条件满足，合并为dblClick
                    cmdInfo = {
                        window: cmdInfo.window,
                        frame: cmdInfo.frame,
                        cmd: 'dblClick',
                        data: data,
                        text: cmdInfo.text
                    };
                }
                else{
                    // 不需要合并，恢复之前旧的click
                    cmdQueue.push(lastCmdInfo2, 2);
                }
            }
            if(cmdInfo.cmd !== 'click'){
                // click 缓存到下一次，确认是否需要合并dblClick，非click立即执行
                cmdQueue.push(cmdInfo, 2);
            }
            else{
                // 500毫秒以内才进行dblClick合并
                dblClickFilterTimer = setTimeout(function(){
                    cmdQueue.push(lastCmdInfo2, 2);
                    lastCmdInfo2 = null;
                }, 500);
            }
            lastCmdInfo2 = cmdInfo;
        }
        if(/^!/.test(cmdInfo.cmd)){
            cmdQueue.push(cmdInfo, 2);
        }
        else{
            sendKeysFilter(cmdInfo);
        }
    }
    function onEnd(bSaveFile){
        recorderBrowser.close(() => {
            recorderBrowser = null;
            console.log('------------------------------------------------------------------'.green);
            if(bSaveFile){
                saveTestFile();
            }
            console.log(__('recorder_server_closed').green);
            console.log(__('recorder_browser_closed').green);
            console.log(`consoleParams:{"type": "signal", "status": "end"}`);
            closeBrowser()
                .then(() => {
                    syncCheckBrowserDrivers = []
                    checkerBrowser = null;
                    if (configJson.serverIp && configJson.serverIp === '127.0.0.1'){
                        chromedriver.kill();
                        chromedriver.on('close', function(){
                            process.exit();
                        });
                    }else {
                        process.exit();
                    }
                })
        });
    }
    function checkAllReady(){
        if(recorderBrowser && ((openChecker && syncCheckBrowserDrivers.length === configJson.webdriver?.syncBrowsers.length) || (mobile && recorderMobileApp) || !(openChecker || mobile))){
            if(continueRecord){
                var testFile = path.resolve(fileName);
                var absfileName = path.relative(rootPath, testFile).replace(/\\/g,'/');
                loadModule(absfileName);
            }
            console.log(`consoleParams:{"type": "signal", "status": "ready"}`);
        }
    }
    async function closeBrowser (){
        if(syncCheckBrowserDrivers){
            for (var browserIndex in syncCheckBrowserDrivers){
                var browser = syncCheckBrowserDrivers[browserIndex];
                await new Promise((resolve) => {
                    const {browserName, browserVersion } = browser;
                    browser.close(() => {
                        console.log(`${__('checker_browser_closed')} ${browserName} ${browserVersion}`.green);
                        resolve();
                    })
                })
            }
        }
    }
    function pushTestCode(cmd, text, ext, codes){
        var title = cmd +': ';
        title += text ? text + ' ( '+ext+' )' : ext;
        lastTestTitle = title;
        arrLastTestCodes = [];
        if(Array.isArray(codes)){
            codes.forEach(function(line){
                arrLastTestCodes.push('    '+line);
            });
        }
        else{
            arrLastTestCodes.push('    '+codes);
        }
        title = title.replace(/^\w+:/, function(all){
            return all.cyan;
        });
        console.log('  '+title);
    }
    function saveTestCode(success, error, browserName='', version='', sessionId='', syncActionId = ''){
        if(checkerBrowser || recorderMobileApp){
            let title = ''
            if(success){
                console.log(`   ${symbols.ok.green+__('exec_succeed').green} ${browserName} ${version}`);
                title = lastTestTitle;
            }
            else{
                console.log(`   ${symbols.err.red+__('exec_failed').red} ${browserName} ${version}`, error && error.message || error);
                title = error && error.message || error;
            }
            (syncCheckBrowserDrivers || recorderMobileApp) && sendWsMessage('checkResult', {
                title: title,
                browserName: browserName,
                version: version,
                success: success,
                sessionId: sessionId,
                syncActionId: syncActionId,
            });
        }
        allCaseCount ++;
        if(!success){
            failedCaseCount ++;
        }
        if(arrLastTestCodes.length > 0){
            if(!success){
                lastTestTitle = '\u00D7 ' + lastTestTitle;
            }
            arrTestCodes.push('it(\''+escapeStr(lastTestTitle)+'\', async function(){');
            arrTestCodes = arrTestCodes.concat(arrLastTestCodes);
            arrTestCodes.push("});");
            arrTestCodes.push("");
            // lastTestTitle = '';
            arrLastTestCodes = [];
        }
    }
    function saveTestFile() {
        if (allCaseCount > 0) {
            var testFile = path.resolve(rootPath + '/' + fileName);
            arrTestCodes = arrTestCodes.map(function(line){
                return line?'    '+ line:'';
            });
            if(continueRecord){
                var testContent = fs.readFileSync(testFile).toString();
                testContent = testContent.replace(/[ \t]+function _\(str\){/, function(all){
                    return arrTestCodes.join('\r\n') + '\r\n' + all;
                });
                fs.writeFileSync(testFile, testContent);
            } else {
                var templateContent = getTemplateContent(mobile);
                mkdirs(path.dirname(testFile));
                var sizeCode = '';
                if(browserSize){
                    sizeCode = '.windowSize('+browserSize[0]+', '+browserSize[1]+')';
                }
                else{
                    sizeCode = '.maximize()';
                }
                if(mobileAppPath){
                    if(!/^https?:\/\//.test(mobileAppPath)){
                        var relAppPath = path.relative(rootPath, mobileAppPath);
                        if(/^\.\./.test(relAppPath) === false){
                            mobileAppPath = relAppPath;
                        }
                    }

                }
                templateContent = templateContent.replace(/\{\$(\w+)\}/g, function(all, name){
                    switch(name){
                        case 'testCodes':
                            return arrTestCodes.join('\r\n');
                        case 'sizeCode':
                            return sizeCode;
                        case 'appPath':
                            return mobileAppPath.replace(/\\/g, '\\\\');
                        case 'platformName':
                            return mobilePlatform;
                    }
                    return all;
                });
                fs.writeFileSync(testFile, templateContent);
                // delete diff base
                var diffbasePath = rootPath + '/diffbase/' + path.dirname(fileName);
                if(fs.existsSync(diffbasePath)){
                    var escapedCaseName = caseName.replace(/.*\//g, '').replace(/\s*[:\.\:\-\s]\s*/g, '_');
                    var dirList = fs.readdirSync(diffbasePath);
                    dirList.forEach(function(item){
                        if(item.indexOf(escapedCaseName) === 0){
                            fs.unlinkSync(diffbasePath + '/' + item);
                        }
                    });
                }

                console.log('@@生成java代码开始@@');
                var arrRawCmdsTarget = [];
                arrRawCmdsTarget = getArrRawCmdsTarget(arrRawCmdsTarget, browserSize, arrRawCmds);
                var javaContent = getJavaTemplateContent(rootPath);
                javaContent = javaContent.replace(/\{\$(\w+)\}/g,arrRawCmdsTarget.join('\r\n'+'        '));
                var testJavaFile = path.resolve(rootPath + '/sample/' + 'JavaUITest.java');
                mkdirs(path.dirname(testJavaFile));
                fs.writeFileSync(testJavaFile, javaContent);
                console.log('@@生成java代码结束@@');
            }

            if(checkerBrowser){
                console.log(__('check_sumary').green, String(allCaseCount).bold, String(allCaseCount-failedCaseCount).bold, String(failedCaseCount).bold.red + colors.styles.green.open);
            }
            else{
                console.log(__('nocheck_sumary').green, String(allCaseCount).bold, mobile?'':('('+__('nocheck').yellow + colors.styles.green.open+')'));
            }
            console.log(__('test_spec_saved').green+fileName.bold);
            if(raw){
                var rawFile = testFile.replace(/\.js$/, '.json');
                var rawFileName = fileName.replace(/\.js$/, '.json');
                if(continueRecord && fs.existsSync(rawFile)){
                    var oldRawContent = fs.readFileSync(rawFile).toString();
                    try{
                        var arrOldRaw = JSON.parse(oldRawContent);
                        arrRawCmds = arrOldRaw.concat(arrRawCmds);
                    }
                    catch(e){}
                }
                fs.writeFileSync(rawFile, JSON.stringify(arrRawCmds, null, 4));
                console.log(__('raw_cmds_saved').green+rawFileName.bold);
            }
            if(isConfigEdited){
                fs.writeFileSync(configFile, JSON.stringify(configJson, null, 4));
                console.log(__('config_saved').green + configPath.bold);
            }
        }
        else{
            console.log(__('no_step_recorded').yellow);
        }
        console.log('');
    }
    function loadModule(moduleName, callback){
        co(function*(){
            console.log(('  -------------- start load '+moduleName+' --------------').gray);
            sendWsMessage('moduleStart', {
                file: moduleName
            });
            isModuleLoading = true;
            var arrTasks = [];
            if(mobile){
                arrTasks.push(runSpec(moduleName, recorderMobileApp, testVars, function(title, errorMsg){
                    title = title.replace(/^\w+:/, function(all){
                        return all.cyan;
                    });
                    console.log('  '+title);
                    console.log('   '+(errorMsg?symbols.err.red+__('exec_failed').red + '\t' + errorMsg:symbols.ok.green+__('exec_succeed').green));
                }));
            }
            else {
                var tmpTestVars = Object.assign({}, testVars);
                arrTasks.push(runSpec(moduleName, recorderBrowser, tmpTestVars, function(title, errorMsg){
                    title = title.replace(/^\w+:/, function(all){
                        return all.cyan;
                    });
                    console.log('  '+title);
                    console.log('   '+(errorMsg?symbols.err.red+__('exec_failed').red + '\t' + errorMsg:symbols.ok.green+__('exec_succeed').green));
                }));
                if (syncCheckBrowserDrivers) {
                    for (var browserIndex in syncCheckBrowserDrivers){
                        var browser = syncCheckBrowserDrivers[browserIndex]
                        arrTasks.push(function*(){
                            yield sleep(200);
                            yield runSpec(moduleName, browser, testVars)
                        });
                    }
                }
            }
            yield arrTasks;
            yield recorderBrowser.sleep(1000);
            if(!mobile){
                yield recorderBrowser.eval(function(done){
                    setInterval(function(){
                        if(document.readyState==='complete')done()
                    }, 10);
                });
            }
            sendWsMessage('config', recorderConfig);
            sendWsMessage('moduleEnd', {
                file: moduleName,
                success: true
            });
            console.log(('  -------------- end load '+moduleName+' --------------').gray);
            isModuleLoading = false;
        }).then(function(){
            callback && callback(null);
        }).catch(function (error) {
            console.log(error)
            console.log(('  -------------- load '+moduleName+' failed --------------').gray);
            sendWsMessage('moduleEnd', {
                file: moduleName,
                success: false
            });
            callback && callback(error);
        });
        function sleep(ms){
            return function(cb){
                setTimeout(cb, ms);
            };
        }
    }
    function* runSpec(name, driver, testVars, callback){
        var runtimeObj = {
            driver: driver,
            testVars: testVars
        };
        var casePath = path.dirname(caseName);
        runtimeObj.screenshotPath = rootPath + '/screenshots/' + casePath;
        runtimeObj.diffbasePath = rootPath + '/diffbase/' + casePath;
        runtimeObj.caseName = caseName.replace(/.*\//g, '').replace(/\s*[:\.\:\-\s]\s*/g, '_');
        mkdirs(runtimeObj.screenshotPath);
        mkdirs(runtimeObj.diffbasePath);
        runtimeObj.stepId = 0;
        global.before = function(func){
            func.call(runtimeObj);
        }
        global.describe = function(){}
        var arrSpecs = [];
        global.it = function(title, func){
            arrSpecs.push({
                title: title,
                func: func
            });
        }
        require(rootPath + '/' + name)();
        var spec;
        for(var i in arrSpecs){
            spec = arrSpecs[i];
            var errorMsg = null;
            try{
                yield spec.func.call(runtimeObj);
            }
            catch(e){
                errorMsg = e;
            }
            callback && callback(spec.title, errorMsg);
        }
    }
    function updateNewVar(name, key){
        testVars[name] = key;
        sendWsMessage('config', recorderConfig);
    }
    function getVarStr(str){
        if(typeof str === 'string'){
            return str.replace(/\{\{(.+?)\}\}/g, function(all, key){
                return testVars[key] || '';
            });
        }
        else{
            return str;
        }
    }
    function escapeStr(str){
        return str.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/\'/g, "\\'");
    }
}

function getTemplateContent(isMobile) {
    var templateName = isMobile ? 'jwebdriver-mobile.js' : 'jwebdriver.js';
    var tempalteFilePath = path.resolve(__dirname, '../template/' + templateName);
    var customTemplateFilePath = path.join(rootPath, './template/', templateName);
    if (fs.existsSync(customTemplateFilePath)) {
        tempalteFilePath = customTemplateFilePath;
    }
    return fs.readFileSync(tempalteFilePath).toString();
}

// get test root
function getRootPath(){
    var rootPath = path.resolve('.');
    while(rootPath){
        if(fs.existsSync(rootPath + '/config.json')){
            break;
        }
        rootPath = rootPath.substring(0, rootPath.lastIndexOf(path.sep));
    }
    return rootPath;
}

// check page error
function isPageError(code){
    return code == '' || / jscontent="errorCode" jstcache="\d+"|diagnoseConnectionAndRefresh|dnserror_unavailable_header|id="reportCertificateErrorRetry"|400 Bad Request|403 Forbidden|404 Not Found|500 Internal Server Error|502 Bad Gateway|503 Service Temporarily Unavailable|504 Gateway Time-out/i.test(code);
}

// start recorder server
function startRecorderServer(config, onReady, onCommand, onEnd){
    var server = http.createServer(function(req, res){
        if(req.url === '/proxy.pac'){
            var wdproxy = config.wdproxy;
            if(wdproxy){
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                var pacContent = 'function FindProxyForURL(url, host){if(!/^(127.0.0.1|localhost)$/.test(host))return "PROXY '+config.wdproxy+'";\r\nreturn "DIRECT"}';
                res.end(pacContent);
            }
            else{
                res.end('No wdproxy finded!');
            }
        }
    });
    server.listen(0, function(){
        var serverPort = server.address().port;
        console.log('');
        console.log(__('recorder_server_listen_on').green, serverAddress, ':', serverPort);
        console.log(`consoleParams:{"type": "server","serverAddress": "${serverAddress}", "serverPort": "${serverPort}"}`);
        onReady(serverAddress, serverPort);
    });
    wsServer = new WebSocketServer({
        httpServer: server,
        autoAcceptConnections: true
    });
    wsServer.on('connect', function(connection) {
        wsConnection = connection;
        sendWsMessage('config', config);
        connection.on('message', function(message) {
            var message = message.utf8Data;
            try{
                message = JSON.parse(message);
            }
            catch(e){};
            var type = message.type;
            switch(type){
                case 'saveCmd':
                    onCommand(message.data);
                    break;
                case 'save':
                    onCommand({
                        cmd: 'end'
                    });
                    setTimeout(function(){
                        wsConnection && wsConnection.close();
                        server.close();
                        onEnd(true);
                    }, 500);
                    break;
                case 'end':
                    onCommand({
                        cmd: 'end'
                    });
                    setTimeout(function(){
                        wsConnection && wsConnection.close();
                        server.close();
                        onEnd(false);
                    }, 500);
                    break;
            }
        });
        connection.on('close', function(reasonCode, description) {
            wsConnection = null;
        });
    });
}

function sendWsMessage(type, data){
    if(wsConnection){
        var message = {
            type: type,
            data: data
        };
        wsConnection.send(JSON.stringify(message));
    }
}

function mkdirs(dirname){
    if(fs.existsSync(dirname)){
        return true;
    }else{
        if(mkdirs(path.dirname(dirname))){
            fs.mkdirSync(dirname);
            return true;
        }
    }
}

function getIPAddress() {
    var ifaces = os.networkInterfaces();
    var ip = '';
    for (var dev in ifaces) {
        ifaces[dev].forEach(function (details) {
            if (ip === '' && details.family === 'IPv4' && !details.internal) {
                ip = details.address;
                return;
            }
        });
    }
    return ip || "127.0.0.1";
};

async function getImage(caseName, driver, domPath, fileName, isRecord=false) {
    let casePath = path.dirname(caseName);
    let syncDiffBasePath = rootPath + '/diffbase/' + casePath + '/'+ 'sync'
    mkdirs(syncDiffBasePath)
    if (isRecord){
        await driver.execute("document.getElementById('uirecorder-tools-pannel').style.display = 'none';")
    }
    let elemShot
    try{
        if (domPath){
            elemShot = await driver.getScreenShot(domPath, `${syncDiffBasePath}/${fileName}`)
        }else {
            elemShot = await driver.getScreenShot('', `${syncDiffBasePath}/${fileName}`)
        }
        if (isRecord){
            await driver.execute("document.getElementById('uirecorder-tools-pannel').style.display = 'block';")
        }
    }catch (e) {
        if (isRecord){
            await driver.execute("document.getElementById('uirecorder-tools-pannel').style.display = 'block';")
        }
        throw new Error(e)
    }

    return elemShot
}

async function startLocalDriver(wdPort) {
    return new Promise(function(resolve, reject){ //做一些异步操作
        detectPort(wdPort).then(async function(port) {
            wdPort = port;
            console.log(`启动本地chromedriver，端口：${wdPort}`);
            chromedriver = chromedriver.start(['--url-base=wd/hub', '--port='+wdPort])
            chromedriver.stdout.unpipe(process.stdout)
            chromedriver.stderr.unpipe(process.stderr)
            setTimeout(function(){
                resolve();
            }, 2000);
        });
    });
}

async function createBrowser(options, callback) {
    let configPath = 'config.json';
    let configFile = path.resolve(rootPath + '/' + configPath);
    let configJson = {};
    if (fs.existsSync(configFile)) {
        let content = fs.readFileSync(configFile).toString();
        try {
            configJson = JSON.parse(content);
        }
        catch (e) {
            console.log(configPath.bold + ' ' + __('json_parse_failed').red, e);
            process.exit(1);
        }
    }
    var capabilities = {
        'browserName': options.browserName || 'chrome',
        'browserVersion': options.version || '',
        "selenoid:options": {
            "sessionTimeout": "60m",
            'enableVNC': true,
            'labels': {
                'manual': 'true'
            },
        }

    };
    if (options.browserSize){
        capabilities["selenoid:options"]["screenResolution"] = options.browserSize
    }
    if (options.httpProxy){
        let envProxy = [];
        envProxy.push(`https_proxy=${options.httpProxy}`)
        if (options.browserName !== 'safari'){
            envProxy.push(`http_proxy=${options.httpProxy}`)
        }
        capabilities["selenoid:options"]["env"] = envProxy
    }

    if (capabilities.browserName === 'chrome'){
        if(options.isRecorder){
            if(options.debug){
                capabilities["goog:chromeOptions"] = {
                    args:['--enable-automation', '--disable-bundled-ppapi-flash', '--load-extension='+path.resolve(__dirname, '../chrome-extension')],
                    prefs: {
                        'plugins.plugins_disabled': ['Adobe Flash Player']
                    }
                };
            }
            else {
                var crxPath = path.resolve(__dirname, '../tool/uirecorder.crx');
                var extContent = fs.readFileSync(crxPath).toString('base64');
                capabilities["goog:chromeOptions"] = {
                    args: ['--disable-bundled-ppapi-flash'],
                    prefs: {
                        'plugins.plugins_disabled': ['Adobe Flash Player']
                    },
                    excludeSwitches: ['enable-automation'],
                    extensions: [extContent],
                };
            }
        }
        else{
            capabilities['goog:chromeOptions'] = {
                args: ['--disable-bundled-ppapi-flash'],
                excludeSwitches: ['enable-automation'],
                prefs: {
                    'plugins.plugins_disabled': ['Adobe Flash Player']
                },
            };
        }
    }else if (capabilities.browserName === 'qq'){
        capabilities['goog:chromeOptions'] = {
            "binary": 'C:\\Program Files\\Tencent\\QQBrowser\\QQBrowser.exe',
        };
    }

    capabilities['browserName'] = browserNameToDriver[options.browserName]

    const browser = await remote({
        hostname: configJson.webdriver.host,
        port: configJson.webdriver.port ? Number(configJson.webdriver.port): 4444,
        path: '/wd/hub/',
        protocol: 'http',
        logLevel: 'error',
        capabilities: capabilities
    })
    const driver = new mBrowser(browser)
    if (driver){
        driver.browserName = options.browserName
        driver.browserVersion = options.version
        try{
            const size = options.browserSize.split('x')
            const width = size[0]
            const height = size[1]
            let hostname = '';
            let port = '';
            if (options.httpProxy){
                const proxy_url = new URL(options.httpProxy)
                hostname = proxy_url.hostname
                port = proxy_url.port
            }
            const setScreenUrl = `http://127.0.0.1:5000/setDisplay?width=${width}&height=${height}&host=${hostname}&port=${port}`
            await driver.url(setScreenUrl);
        }catch (e) {
            console.log(e);
        }
    }
    callback(driver)
}

module.exports = startRecorder;
