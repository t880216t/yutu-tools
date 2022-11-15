var path = require('path');
var fs = require('fs');
var os = require('os');
var http = require('http');
var async = require('async');
var url = require('url');
var co = require('co');
var chai = require("chai");
var should = chai.should();
const { v4: uuidv4 } = require('uuid');
const { remote } = require('webdriverio');
const $ = require('jquery');
const resemble = require('resemblejs-node');
resemble.outputSettings({
    errorType: 'flatDifferenceIntensity'
});
var pkg = require('../package.json');
var mBrowser = require('./browser')
var WebSocketServer = require('websocket').server;
var i18n = require('./i18n');
var colors = require('colors');
var detectPort = require('detect-port');


// 基本变量
var symbols = {
    ok: '✓',
    err: '✖'
};
let mainBrowserStartTimeout = 1000;
let syncBrowserStartTimeout = 0;
if (process.platform === 'win32') {
    symbols.ok = '\u221A';
    symbols.err = '\u00D7';
    mainBrowserStartTimeout = 0;
    syncBrowserStartTimeout = 1000;
}

let rootPath = getRootPath();

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

async function getImage(driver, domPath, fileName, isRecord=false) {
    let syncDiffBasePath = rootPath + '/diffOutput/sync'
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


// 发送消息给自定义客户端
function sendWsMessage(type, data){
    if(wsConnection){
        var message = {
            type: type,
            data: data
        };
        wsConnection.send(JSON.stringify(message));
    }
}

// 启动监听中心服务器
function startRecorderServer(config, onReady, onCommand, onEnd){
    var server = http.createServer(function(req, res){
        if(req.url.indexOf('/proxy.pac')>-1){
            const path = url.parse(req.url,true).query
            let wdproxy;
            if (path.isMain && Number(path.isMain)){
                wdproxy = config.mainBrowser.httpProxy.replace('http://','').replace('https://','')
            }else if(path.browserId){
                config.syncBrowsers.forEach(item => {
                    if (item.id == path.browserId){
                        wdproxy = item.httpProxy.replace('http://','').replace('https://','')
                    }
                })
            }
            if(wdproxy){
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                let pacContent = 'function FindProxyForURL(url, host){if(!/^(127.0.0.1|localhost|10.10.*|192.168.*|10.110.*)$/.test(host))return "PROXY '+wdproxy+'";\r\nreturn "DIRECT"}';
                res.end(pacContent);
            }
            else{
                res.end('No wdproxy finded!');
            }
        }else{
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            let pacContent = 'function FindProxyForURL(url, host){return "DIRECT"}';
            res.end(pacContent);
        }
    });
    server.listen(0, function(){
        var serverPort = server.address().port;
        console.log('');
        console.log(__('recorder_server_listen_on').green, config.serverAddress, ':', serverPort);
        console.log(`consoleParams:{"type": "server","serverAddress": "${config.serverAddress}", "serverPort": "${serverPort}"}`);
        onReady(config.serverAddress, serverPort);
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
                        onEnd();
                    }, 500);
                    break;
                case 'end':
                    onCommand({
                        cmd: 'end'
                    });
                    setTimeout(function(){
                        wsConnection && wsConnection.close();
                        server.close();
                        onEnd();
                    }, 500);
                    break;
            }
        });
        connection.on('close', function(reasonCode, description) {
            wsConnection = null;
        });
    });
}

async function createBrowser(options, callback) {
    var capabilities = {
        'browserName': options.browserName,
        'browserVersion': options.host !== '127.0.0.1' ? options.browserVersion: undefined,
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
        // selenoid docker
        // let envProxy = [];
        // envProxy.push(`https_proxy=${options.httpProxy}`)
        // if (options.browserName !== 'safari'){
        //     envProxy.push(`http_proxy=${options.httpProxy}`)
        // }
        // capabilities["selenoid:options"]["env"] = envProxy

        // windows
        let wdPacUrl = `http://${options.serverAddress}:${options.serverPort}/proxy.pac?isMain=${options.isMainBrowser?1:0}&browserId=${options.id}`;
        capabilities["proxy"] = {
            'proxyType': 'pac',
            'proxyAutoconfigUrl': wdPacUrl
        };
    }


    if (capabilities.browserName === 'chrome'){
        if(options.isMainBrowser){
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
        else{
            capabilities['goog:chromeOptions'] = {
                args: ['--disable-bundled-ppapi-flash'],
                excludeSwitches: ['enable-automation'],
                prefs: {
                    'plugins.plugins_disabled': ['Adobe Flash Player']
                },
            };
        }
        if (options.binary){
            capabilities['goog:chromeOptions']["binary"] = options.binary
        }
    }
    if (capabilities.browserName === 'firefox'){
        capabilities['moz:firefoxOptions'] = {}
        if (options.binary){
            capabilities['moz:firefoxOptions']["binary"] = options.binary
        }
    }
    if (capabilities.browserName === 'internet explorer'){
        capabilities['se:ieOptions'] = {
            ignore_protected_mode_settings: true
        }
        // {
        //     browser_attach_timeout: 'browserAttachTimeout',
        //     element_scroll_behavior: 'elementScrollBehavior',
        //     full_page_screenshot: 'ie.enableFullPageScreenshot',
        //     ensure_clean_session: 'ie.ensureCleanSession',
        //     file_upload_dialog_timeout: 'ie.fileUploadDialogTimeout',
        //     force_create_process_api: 'ie.forceCreateProcessApi',
        //     force_shell_windows_api: 'ie.forceShellWindowsApi',
        //     ignore_protected_mode_settings: 'ignoreProtectedModeSettings',
        //     ignore_zoom_level: 'ignoreZoomSetting',
        //     initial_browser_url: 'initialBrowserUrl',
        //     native_events: 'nativeEvents',
        //     persistent_hover: 'enablePersistentHover',
        //     require_window_focus: 'requireWindowFocus',
        //     use_per_process_proxy: 'ie.usePerProcessProxy',
        //     use_legacy_file_upload_dialog_handling: 'ie.useLegacyFileUploadDialogHandling',
        //     attach_to_edge_chrome: 'ie.edgechromium',
        //     edge_executable_path: 'ie.edgepath'
        // }
    }

    const browser = await remote({
        hostname: options.host,
        port: Number(options.port),
        path: '/wd/hub/',
        protocol: 'http',
        logLevel: 'error',
        capabilities: capabilities
    })
    const driver = new mBrowser(browser)
    if (driver){
        driver.id = options.id
        driver.displayName = options.displayName
        driver.browserName = options.browserName
        driver.browserVersion = options.browserVersion
        try {
            await browser.maximizeWindow();
        } catch (e) {
            console.log(e);
            try{
                const size = options.browserSize.split('x')
                const width = Number(size[0])
                const height = Number(size[1])
                if (width && height){
                    await browser.setWindowSize(width, height);
                }
            }catch (e) {
                console.log(e);
            }
        }
    }
    callback(driver)
}

async function startRecorder(){
    console.log("启动同步服务".green)
    // 获取同步配置
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
        mainBrowserStartTimeout = recorderFirst ? 0 : 1000;
        syncBrowserStartTimeout = recorderFirst ? 1000 : 0;
    }
    var testVars = configJson.vars;

    var mainBrowser;
    var syncBrowsers = [];
    var lastWindowId = 0;
    var lastFrameId = null;
    var lastTestTitle = '';
    var allCaseCount = 0;
    var failedCaseCount = 0;
    var isModuleLoading = false;
    var arrSendKeys = [];
    var lastCmdInfo0 = null;
    var lastCmdInfo1 = null;
    var lastCmdInfo2 = null;
    var dblClickFilterTimer = null;

    // 操作行为监听
    var cmdQueue = async.priorityQueue(function(cmdInfo, next) {
        if(isModuleLoading){
            return next();
        }
        var window = cmdInfo.window;
        var frame = cmdInfo.frame;
        var cmd = cmdInfo.cmd;
        var data = cmdInfo.data;
        let syncActionId = uuidv4();
        let casePath = path.dirname('test');
        let syncDiffOutputBasePath = rootPath + '/diffOutput/sync'
        if (data && data.type === 'fulldiff'){
            data.type = 'imgdiff'
            data.params = ['']
        }
        if(cmd === 'end'){
            return next();
        }
        let arrTasks = [];
        arrTasks.push(async function(callback){
            function doNext(browser){
                const {browserName, browserVersion, sessionId, displayName} = browser
                saveTestCode({success: true, error: '', browserName, browserVersion, sessionId, displayName});
            }
            function catchError(error, browser){
                const {browserName, browserVersion, sessionId, displayName} = browser
                saveTestCode({success: false, error, browserName, browserVersion, sessionId, displayName});
            }
            if(window !== lastWindowId){
                lastWindowId = window;
                lastFrameId = null;
                await mainBrowser.switchWindowWithIndex(lastWindowId)
                const title = await mainBrowser.getTitle()
                pushTestCode('switchWindow', lastWindowId, title)
                syncBrowsers.forEach(browser => browser.switchWindowWithIndex(window).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                callback();
            }
            else{
                callback();
            }
        });
        arrTasks.push(function(callback){
            function doNext(browser){
                const {browserName, browserVersion, sessionId, displayName} = browser
                saveTestCode({success: true, error: '', browserName, browserVersion, sessionId, displayName});
            }
            function catchError(error, browser){
                const {browserName, browserVersion, sessionId, displayName} = browser
                saveTestCode({success: false, error, browserName, browserVersion, sessionId, displayName});
            }
            if(frame !== lastFrameId){
                lastFrameId = frame;
                pushTestCode('switchFrame', '', frame);
                syncBrowsers && syncBrowsers.forEach(browser => browser.switchToFrame(frame).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                callback();
            }
            else{
                callback();
            }
        });
        arrTasks.push(async function(callback){
            function doNext(browser){
                const {browserName, browserVersion, sessionId, displayName} = browser
                saveTestCode({success: true, error: '', browserName, browserVersion, sessionId, displayName, syncActionId, syncDiffImgPath: `${syncDiffOutputBasePath}/diff_${syncActionId}_${sessionId}.png`});
            }
            function catchError(error, browser){
                const {browserName, browserVersion, sessionId, displayName} = browser
                saveTestCode({success: false, error, browserName, browserVersion, sessionId, displayName, syncActionId, syncDiffImgPath: `${syncDiffOutputBasePath}/diff_${syncActionId}_${sessionId}.png`});

            }
            var reDomRequire = /^(val|text|displayed|enabled|selected|attr|css|count|imgdiff)$/;
            var reParamRequire = /^(attr|css|cookie|localStorage|sessionStorage|alert)$/;
            switch(cmd){
                case 'url':
                    pushTestCode('url', '', data);
                    syncBrowsers.forEach(browser => browser.url(getVarStr(eval('\`'+data+'\`'))).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'waitBody':
                    pushTestCode('waitBody', '', '');
                    syncBrowsers.forEach(browser => browser?.sessionId&&browser.$('body').waitForExist({timeout: 10000}).then(() => doNext(browser))
                            .catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'click':
                    var option = data.option;
                    pushTestCode(option?'optionClick':'click', data.text, data.path + ', ' + data.x + ', ' + data.y + ', ' + data.button);
                    syncBrowsers.forEach(browser => browser.waitClick(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'touchClick':
                    pushTestCode('touchClick', data.text, data.path);
                    syncBrowsers.forEach(browser => browser.waitClick(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'dblClick':
                    pushTestCode('dblClick', data.text, data.path + ', ' + data.x + ', ' + data.y + ', ' + data.button);
                    syncBrowsers.forEach(browser => browser.$(data.path).doubleClick().then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'closeWindow':
                    pushTestCode('closeWindow', '', '', 'await driver.closeWindow();');
                    syncBrowsers.forEach(browser => browser.closeCurrentWindow().then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'sleep':
                    pushTestCode('sleep', '', data, 'await driver.sleep('+data+');');
                    syncBrowsers.forEach(browser => browser.sleep(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'eval':
                    pushTestCode('eval', '', data.replace(/\n/g, ' \\n '), 'await driver.eval(_(\''+escapeStr(data)+'\'));');
                    syncBrowsers.forEach(browser => browser.execute(getVarStr(data)).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'mouseMove':
                    pushTestCode('mouseMove', data.text, data.path+(data.x !== undefined?', '+data.x+', '+data.y:''));
                    syncBrowsers.forEach(browser => browser.mouseMove(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'mouseDown':
                    pushTestCode('mouseDown', data.text, data.path + ', ' + data.x + ', ' + data.y + ', ' + data.button);
                    syncBrowsers.forEach(browser => browser.mouseDown(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'mouseUp':
                    pushTestCode('mouseUp', data.text, data.path + ', ' + data.x + ', ' + data.y + ', ' + data.button);
                    syncBrowsers.forEach(browser => browser.mouseUp(data.button).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'sendKeys':
                    pushTestCode('sendKeys', '', data.keys, 'await driver.sendKeys(\''+escapeStr(data.keys)+'\');');
                    syncBrowsers.forEach(browser => browser.sendKeys(data.keys).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'keyDown':
                    pushTestCode('keyDown', '', data.character, 'await driver.keyDown(\''+escapeStr(data.character)+'\');');
                    syncBrowsers.forEach(browser => browser.sendKeys(data.character).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'keyUp':
                    pushTestCode('keyUp', '', data.character, 'await driver.keyUp(\''+escapeStr(data.character)+'\');');
                    syncBrowsers.forEach(browser => browser.sendKeys(data.character).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'scrollTo':
                    pushTestCode('scrollTo', '', data.x + ', ' + data.y, 'await driver.scrollTo('+data.x+', '+data.y+');');
                    syncBrowsers.forEach(browser => browser?.sessionId&&browser.scrollTo(data.x, data.y).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'scrollElementTo':
                    pushTestCode('scrollElementTo', data.text, data.path+(data.x !== undefined?', '+data.x+', '+data.y:''));
                    syncBrowsers.forEach(browser => browser.scrollElementTo(data).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'select':
                    pushTestCode('select', data.text, data.path + ', ' + data.type + ', ' + data.value);
                    syncBrowsers.forEach(browser => browser.$(data.path).selectByAttribute(data.type, data.value).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'acceptAlert':
                    pushTestCode('acceptAlert', '', '', 'await driver.acceptAlert();');
                    syncBrowsers.forEach(browser => browser.acceptAlert().then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'dismissAlert':
                    pushTestCode('dismissAlert', '', '', 'await driver.dismissAlert();');
                    syncBrowsers.forEach(browser => browser.dismissAlert().then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'setAlert':
                    pushTestCode('setAlert', '', data.text, 'await driver.setAlert("'+data.text+'");');
                    syncBrowsers.forEach(browser => browser.sendAlertText(data.text).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                case 'uploadFile':
                    pushTestCode('uploadFile', data.text, data.path + ', ' + data.filename);
                    // 未实现
                    // syncBrowsers.forEach(browser => browser.upload(data, rootPath+'/uploadFiles/'+data.filename).then(() => doNext(browser)).catch(e => catchError(e, browser)) || doNext(browser));
                    break;
                // 添加断言
                case 'expect':
                    var sleepTime = data.sleep;
                    var expectType = data.type;
                    var expectParams = data.params;
                    var expectCompare = data.compare;
                    var expectTo = data.to;
                    var codeExpectTo = expectTo.replace(/"/g, '\\"').replace(/\n/g, '\\n');
                    pushTestCode('expect', '', expectType + ', ' + String(expectParams) + ', ' + expectCompare + ', ' + expectTo);
                    syncBrowsers.forEach(browser => co(function*(){
                        let element, value;
                        if(expectType === 'count'){
                            value = yield browser.findElements(expectParams[0]).length;
                        }else if(expectType === 'imgdiff'){
                            let syncMainImg = '';
                            let checkImg = '';
                            const syncMainImgName = `${syncActionId}_main.png`
                            const checkImgName = `${syncActionId}_${browser.sessionId}.png`
                            yield mainBrowser.switchWindowWithIndex(lastWindowId)
                            syncMainImg = yield getImage(mainBrowser, escapeStr(expectParams[0]), syncMainImgName, true )
                            checkImg = yield getImage(browser, escapeStr(expectParams[0]), checkImgName)

                            if (checkImg && syncMainImg){
                                syncMainImg = Buffer.from(syncMainImg, 'base64');
                                checkImg = Buffer.from(checkImg, 'base64');

                                const imgDiffPath = `${syncDiffOutputBasePath}/diff_${checkImgName}`

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
                        } else{
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
            }
            callback();
        });
        async.series(arrTasks, function(){
            next();
        });
    },1)

    var recorderConfig = {
        serverAddress: configJson.serverIp,
        version: pkg.version,
        pathAttrs : pathAttrs,
        attrValueBlack: attrValueBlack,
        classValueBlack: classValueBlack,
        hideBeforeExpect: hideBeforeExpect,
        mainBrowser: configJson.webdriver?.mainBrowser,
        syncBrowsers: configJson.webdriver?.syncBrowsers,
        testVars: testVars,
        i18n: __('chrome')
    };

    startRecorderServer(recorderConfig, onReady, onCommand, onEnd);
    function onReady(serverAddress, serverPort){
        // 启动主控浏览器
        setTimeout(() => {
            createBrowser({
                id: configJson.webdriver.mainBrowser.id,
                browserName: configJson.webdriver.mainBrowser.browserName,
                winUser: configJson.webdriver.mainBrowser.winUser,
                displayName: configJson.webdriver.mainBrowser.displayName,
                browserVersion: configJson.webdriver.mainBrowser.version,
                browserSize: configJson.webdriver.mainBrowser.browserSize,
                httpProxy: configJson.webdriver.mainBrowser.httpProxy,
                binary: configJson.webdriver.mainBrowser.binary,
                isMainBrowser: true,
                serverAddress: serverAddress,
                serverPort: serverPort,
                host: configJson.webdriver.host,
                port: configJson.webdriver.port,
            },async function(browser){
                const extensionUrl = `chrome-extension://njkfhfdkecbpjlnfmminhmdcakopmcnc/start.html?port=${serverPort}&ip=${serverAddress}&defaultUrl=${encodeURIComponent(configJson.defaultUrl ||'')}`;
                await browser.url(extensionUrl);
                await browser.execute('document.title="'+__('recorder_browser_title')+' - UIRecorder"');
                console.log(`${__('recorder_browser_opened')} ${browser?.sessionId}`.green);
                console.log(`consoleParams:{"sessionId": "${browser?.sessionId}", "type": "main", "id": "${browser.id}"}`);
                mainBrowser = browser;
                checkAllReady();
            })
        }, mainBrowserStartTimeout)
        if (configJson.webdriver?.syncBrowsers.length > 0){
            configJson.webdriver?.syncBrowsers.map(browserInfo => {
                setTimeout(function(){
                    createBrowser({
                        id: browserInfo.id,
                        browserName: browserInfo.browserName,
                        displayName: browserInfo.displayName,
                        browserVersion: browserInfo.version,
                        winUser: browserInfo.winUser,
                        httpProxy: browserInfo.httpProxy,
                        binary: browserInfo.binary,
                        isMainBrowser: false,
                        serverAddress: serverAddress,
                        serverPort: serverPort,
                        browserSize: browserInfo.browserSize,
                        host: configJson.webdriver.host,
                        port: configJson.webdriver.port,
                    }, async function(browser){
                        await browser.execute('document.title="'+__('checker_browser_title')+' - Yutu sync tools";');
                        console.log(`${__('checker_browser_opened')} ${browser?.sessionId}`.green);
                        console.log(`consoleParams:{"sessionId": "${browser?.sessionId}", "type": "sync", "browserInfo": "${browserInfo.displayName}:${browserInfo.version}", "id": "${browserInfo.id}"}`);
                        console.log('');
                        syncBrowsers.push(browser)
                        checkAllReady();
                    });
                }, syncBrowserStartTimeout);
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
            if(cmd === 'sendKeys'){
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
    function onEnd(){
        mainBrowser.close(() => {
            mainBrowser = null;
            console.log('------------------------------------------------------------------'.green);
            console.log(__('recorder_server_closed').green);
            console.log(__('recorder_browser_closed').green);
            console.log(`consoleParams:{"type": "signal", "status": "end"}`);
            closeBrowser()
                .then(() => {
                    syncBrowsers = []
                    process.exit();
                })
        });
    }
    function checkAllReady(){
        if(mainBrowser && (syncBrowsers?.length === configJson.webdriver?.syncBrowsers.length)){
            console.log(`consoleParams:{"type": "signal", "status": "ready"}`);
        }
    }
    async function closeBrowser (){
        if(syncBrowsers){
            for (var browserIndex in syncBrowsers){
                var browser = syncBrowsers[browserIndex];
                await new Promise((resolve) => {
                    const {displayName, browserVersion } = browser;
                    browser.close(() => {
                        console.log(`${__('checker_browser_closed')} ${displayName} ${browserVersion}`.green);
                        resolve();
                    })
                })
            }
        }
    }
    function saveTestCode(options){
        const {success, error, browserName, browserVersion, sessionId, displayName, syncActionId, syncDiffImgPath, } = options
        let title = ''
        if(success){
            console.log(`   ${symbols.ok.green+__('exec_succeed').green} ${displayName} ${browserVersion}`);
            title = lastTestTitle;
        }
        else{
            console.log(`   ${symbols.err.red+__('exec_failed').red} ${displayName} ${browserVersion}`, error && error.message || error);
            title = error && error.message || error;
        }
        sendWsMessage('checkResult', {
            title: title,
            browserName: browserName,
            displayName: displayName,
            version: browserVersion,
            success: success,
            sessionId: sessionId,
            syncActionId: syncActionId,
        })
        allCaseCount ++;
        if(!success){
            failedCaseCount ++;
            lastTestTitle = '\u00D7 ' + lastTestTitle;
        }
    }
    function pushTestCode(cmd, text, ext){
        var title = cmd +': ';
        title += text ? text + ' ( '+ext+' )' : ext;
        lastTestTitle = title;
        title = title.replace(/^\w+:/, function(all){
            return all.cyan;
        });
        console.log('  '+title);
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

module.exports = startRecorder;
