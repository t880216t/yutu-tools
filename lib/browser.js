const gm = require('gm');
const fs = require('fs');
const Keys = {
    NULL: '\uE000',
    CANCEL: '\uE001',
    HELP: '\uE002',
    BACK_SPACE: '\uE003',
    TAB: '\uE004',
    CLEAR: '\uE005',
    RETURN: '\uE006',
    ENTER: '\uE007',
    SHIFT: '\uE008',
    CONTROL: '\uE009',
    CTRL: '\uE009',
    ALT: '\uE00A',
    PAUSE: '\uE00B',
    ESCAPE: '\uE00C',
    SPACE: '\uE00D',
    PAGE_UP: '\uE00E',
    PAGE_DOWN: '\uE00F',
    END: '\uE010',
    HOME: '\uE011',
    ARROW_LEFT: '\uE012',
    LEFT: '\uE012',
    ARROW_UP: '\uE013',
    UP: '\uE013',
    ARROW_RIGHT: '\uE014',
    RIGHT: '\uE014',
    ARROW_DOWN: '\uE015',
    DOWN: '\uE015',
    INSERT: '\uE016',
    DELETE: '\uE017',
    SEMICOLON: '\uE018',
    EQUALS: '\uE019',

    NUMPAD0: '\uE01A',
    NUMPAD1: '\uE01B',
    NUMPAD2: '\uE01C',
    NUMPAD3: '\uE01D',
    NUMPAD4: '\uE01E',
    NUMPAD5: '\uE01F',
    NUMPAD6: '\uE020',
    NUMPAD7: '\uE021',
    NUMPAD8: '\uE022',
    NUMPAD9: '\uE023',
    MULTIPLY: '\uE024',
    ADD: '\uE025',
    SEPARATOR: '\uE026',
    SUBTRACT: '\uE027',
    DECIMAL: '\uE028',
    DIVIDE: '\uE029',

    F1: '\uE031',
    F2: '\uE032',
    F3: '\uE033',
    F4: '\uE034',
    F5: '\uE035',
    F6: '\uE036',
    F7: '\uE037',
    F8: '\uE038',
    F9: '\uE039',
    F10: '\uE03A',
    F11: '\uE03B',
    F12: '\uE03C',

    COMMAND: '\uE03D',
    META: '\uE03D'
};

class mBrowser {
    constructor(browser) {
        const handers = {
            get(obj, key){
                return key in obj?obj[key]: browser[key]
            }
        }
        return new Proxy(this, handers);
    }

    sleep(ms) {
        let self = this
        return new Promise((resolve) => setTimeout(() => {
            resolve(self)
        }, ms))
    }

    wait(path, timeout){
        let self = this
        return new Promise((resolve) =>
            self.$(path)
                .waitForClickable({ timeout})
                .then(
                    () => resolve(self)
                )
        )
    }

    async mouseMove(data){
        await this.$(data.path).moveTo({ xOffset: data.x, yOffset: data.y })
    }

    async mouseDown(data){
        await this.$(data.path).dragAndDrop({ x: data.x, y: data.y })
    }

    async scrollElementTo(data){
        const elems = await this.$$(data.path);
        if (elems.length > 0){
            await this.execute((elements, x, y) => {
                var element;
                for(var i=0,len=elements.length;i<len;i++){
                    element = elements[i];
                    element.scrollLeft = x;
                    element.scrollTop = y;
                }
            }, elems, data.x, data.y);
        }else{
            throw new Error(`Can't get elements by ${data.path}`)
        }
    }

    async mouseUp(data){
        await this.releaseActions()

    }

    async upload(data, filePath){
        const remoteFilePath = await this.uploadFile(filePath)
        await this.$(data.path).setValue(remoteFilePath)
    }

    async sendKeys(text){
        if((typeof text=='string')&&text.constructor==String){
            const newText = text.replace(/{(\w+)}/g, function(all, name){
                let key = Keys[name.toUpperCase()];
                return key?key:all;
            })
            await this.keys(newText.split(''))
        }
    }

    async scrollTo(x, y){
        let script = `window.scrollTo(${x}, ${y});`;
        await this.execute(script);
    }

    async waitClick(data, timeout=2000){
        let element = await this.$(data.path)
        const elements = await this.$$(data.path)
        for(var i=0,len=elements.length;i<len;i++){
            let clickable = await elements[i].isClickable();
            if (clickable){
                element = elements[i]
            }
        }
        if (element){
            let x = data.x || 0;
            let y = data.y || 0;
            const {width, height} = await element.getSize();
            const offsetX = Math.round(x - (width/2))
            const offsetY = Math.round(y - (height/2))
            await element.click({button: data.button, x: offsetX, y: offsetY})
        }else {
            throw new Error(`Can't get elements by ${data.path}`)
        }
    }

    async close(done){
        await this.deleteSession().then(() => done && done())
    }

    async switchWindowWithIndex(windowHandle){
        await this.waitUntil(
            async () => {
                const windows = await this.getWindowHandles()
                const indexWindow = windows[windowHandle]
                if (indexWindow){
                    await this.switchToWindow(indexWindow)
                }
                return indexWindow !== undefined
            }
            ,{timeout: 2000,timeoutMsg: 'Window index overflow after 2s'}
        );
    }

    async getScreenShot(domPath, filename='temp.png'){
        let self = this;
        let png64 = ''
        await self.saveScreenshot(filename).then(
            async () => {
                let gmShot = gm(filename).quality(100);
                if(gmShot){
                    if(domPath){
                        const element = await self.$(domPath)
                        const ratio = await self.execute(() => {
                            return window.devicePixelRatio
                        })
                        const scrollPosition = await self.execute(() => {
                            return window.pageYOffset
                        })
                        if(element){
                            let rect, x, y, width, height;

                            try{
                                rect = await self.getElementRect(element.elementId);
                                x = rect.x * ratio;
                                y = (rect.y - scrollPosition) * ratio;
                                width = rect.width * ratio;
                                height = rect.height * ratio;
                            }catch (e) {
                                const size =  await element.getSize();
                                const location =  await element.getLocation();
                                x = location.x * ratio;
                                y = (location.y - scrollPosition)* ratio;
                                width = size.width * ratio;
                                height = size.height * ratio;
                            }

                            gmShot.crop(width, height, x, y);
                        }
                    }
                    png64 = await new Promise((resolve, reject) => gmShot.toBuffer('PNG', (error, buffer) => error ? reject(error):resolve(buffer)));
                    png64 =png64.toString('base64');
                    if(filename){
                        fs.writeFileSync(filename, png64, 'base64');
                    }
                }
            }
        )
        return png64
    }

    async closeCurrentWindow(){
        let self = this;
        await self.getWindowHandles()
            .then(ret => {
                if (ret.length >1){
                    try{
                        self.closeWindow()
                    }
                    catch(e){
                        throw new Error(e)
                    }
                }else{
                    throw new Error('Window index can not be close')
                }
            })
    }
}

module.exports = mBrowser;
