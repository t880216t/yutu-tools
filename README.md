# Yutu tools

---


[![NPM version](https://img.shields.io/npm/v/uirecorder.svg?style=flat-square)](https://www.npmjs.com/package/yutu-tools)
[![License](https://img.shields.io/npm/l/uirecorder.svg?style=flat-square)](https://www.npmjs.com/package/yutu-tools)

本项目是对 [UI Recorder](https://github.com/alibaba/uirecorder) 的深度改造，用来实现与selenium-grid打通的多端同步操作驱动。

在此也感谢UI Recorder项目的每一位贡献者！

# 功能

1. 支持所有用户行为: 键盘事件, 鼠标事件, alert, 文件上传, 拖放, svg, shadow dom
2. 无干扰同步: 和正常测试无任何区别，无需任何交互
3. 支持丰富的断言类型
4. 支持自定义数量、类型、版本的浏览器同步操作
5. 支持图片元素或全屏截图对比
6. 全系统支持: Windows, Mac, Linux
7. 支持远程hub的浏览器调用同步对比
8. 支持多用户配置

# 快速开始

## 安装

1. 安装 NodeJs (版本号 >= v7.x)

   > [https://nodejs.org/](https://nodejs.org/)

   > `sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}` (Mac, Linux)

2. 安装 chrome

   > [https://www.google.com/chrome/](https://www.google.com/chrome/)

3. 安装 Yutu

   > `npm install yutu-tools -g`
   >
   > 其中它的图片对比能力是来自于```graphicsmagick ```，因此还需要额外安装下
   mac：```brew install graphicsmagick```

## PC同步操作&录制

1. 初始化测试工程

   > 创建新文件夹

   > `yutu init`

2. 启动WebDriver服务器
   > 建议使用selenium-grid管理本地多个浏览器

   > 并手动修改```config.json```中的主控浏览器及同步浏览器配置如下：

```json
{
    "webdriver": {
        "host": "127.0.0.1",  // 远程hub地址
        "port": "4444",
        "mainBrowser": {
            "browserId": 2,
            "displayName": "chrome",
            "browserName": "chrome",
            "version": "106",
            "httpProxy": "",
            "binary": null,
            "userDataDir": "/UsersData/Chrome/Default"
        },
        "syncBrowsers": [
            {
                "browserId": 1,  // 浏览器的唯一标识
                "httpProxy": "",  // 浏览器代理
                "screenSize": "1920x1080x24", // 自定义参数，暂未启用
                "browserName": "firefox",  // 浏览器内核的名字，如：chrome、firefox
                "displayName": "firefox",   // 浏览器的名字如：qq、yandex
                "version": "105",
                "binary": null,  // chromium内核的国产浏览器的exe执行文件路径
                "userDataDir": "/UsersData/Chrome/Default" // 用户配置路径
            }
        ]
    },
    "browserSize": "1920x1080x24",
    "defaultUrl": "https://www.baidu.com/",
    "vars": {},
    "serverIp": "192.168.1.101",  //本地执行命令机器的ip，非远程webdriver，可以使用127.0.0.1
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
}
```

3. 开始多浏览器的同步操作

    > `yutu start`


# License

yutu is released under the MIT license.

# 感谢

* uirecorder: [https://github.com/alibaba/uirecorder](https://github.com/alibaba/uirecorder)
* jWebDriver: [https://github.com/yaniswang/jWebDriver](https://github.com/yaniswang/jWebDriver)
* chai: [https://github.com/chaijs/chai](https://github.com/chaijs/chai)
* macaca-mocha-parallel-tests: [https://github.com/macacajs/macaca-mocha-parallel-tests](https://github.com/macacajs/macaca-mocha-parallel-tests)
* macaca-reporter: [https://github.com/macacajs/macaca-reporter](https://github.com/macacajs/macaca-reporter)
