# Yutu tools

---


[![NPM version](https://img.shields.io/npm/v/uirecorder.svg?style=flat-square)](https://www.npmjs.com/package/yutu-tools)
[![License](https://img.shields.io/npm/l/uirecorder.svg?style=flat-square)](https://www.npmjs.com/package/yutu-tools)

本项目是对 [UI Recorder](https://github.com/alibaba/uirecorder) 的深度改造，用来实现与selenium-grid打通的多端同步操作驱动。

在此也感谢UI Recorder项目的每一位贡献者！

# 功能

1. 支持所有用户行为: 键盘事件, 鼠标事件, alert, 文件上传, 拖放, svg, shadow dom
2. 全平台支持，移动端 Android, iOS 录制, 基于 [Macaca](https://macacajs.github.io) 实现
3. 无干扰录制: 和正常测试无任何区别，无需任何交互
4. 录制用例存储在本地
5. 支持丰富的断言类型: val,text,displayed,enabled,selected,attr,css,url,title,cookie,localStorage,sessionStorage
6. 支持图片对比
7. 支持强大的变量字符串
8. 支持公共测试用例: 允许用例中动态调用另外一个
9. 支持并发测试
10. 支持多国语言: 英文, 简体中文, 繁体中文
11. 支持单步截图
12. 支持HTML报告和JUnit报告
13. 全系统支持: Windows, Mac, Linux
14. 基于Nodejs的测试用例: [jWebDriver](http://jwebdriver.com/)

------扩展功能------
15. 支持自定义数量浏览器的同步操作
16. 支持远程hub的浏览器调用录制对比

# 快速开始

## 安装

1. 安装 NodeJs (版本号 >= v7.x)

   > [https://nodejs.org/](https://nodejs.org/)

   > `sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}` (Mac, Linux)

2. 安装 chrome

   > [https://www.google.com/chrome/](https://www.google.com/chrome/)

3. 安装 Yutu

   > `npm install yutu-tools mocha -g`

## PC同步操作&录制

1. 初始化测试工程

   > 创建新文件夹

   > `yutu init --server_ip=192.168.1.108 --hub_url=192.168.68.153 --hub_port=4444 --main_client=chrome:101 --sync=chrome:101,chrome:100 `

2. 启动WebDriver服务器

3. 开始录制测试用例和多浏览器的同步操作

    > `yutu sample/test.spec.js`

4. 运行测试用例

   > 运行所有脚本: `source run.sh` ( Linux|Mac ) 或 `run.bat` ( Windows )

   > 运行单个脚本: `source run.sh sample/test.spec.js` ( Linux|Mac ) 或 `run.bat sample/test.spec.js` ( Windows )

5. 获得测试报告和单步截图

   > ./reports/index.html

   > ./reports/index.xml (JUnit)

   > ./reports/index.json

   > ./screenshots/


# License

yutu is released under the MIT license.

# 感谢

* uirecorder: [https://github.com/alibaba/uirecorder](https://github.com/alibaba/uirecorder)
* jWebDriver: [https://github.com/yaniswang/jWebDriver](https://github.com/yaniswang/jWebDriver)
* chai: [https://github.com/chaijs/chai](https://github.com/chaijs/chai)
* macaca-mocha-parallel-tests: [https://github.com/macacajs/macaca-mocha-parallel-tests](https://github.com/macacajs/macaca-mocha-parallel-tests)
* macaca-reporter: [https://github.com/macacajs/macaca-reporter](https://github.com/macacajs/macaca-reporter)
