# agentsview · 团队版使用说明

这是 [kenn-io/agentsview](https://github.com/kenn-io/agentsview) 的团队 fork。
agentsview 是一个**跑在你自己电脑上的网页**，用来翻看和搜索本机所有 AI 编码助手
(Codex、Claude Code 等二十多种)的历史会话：它跑过哪些命令、读过哪些文件、读到了什么。

数据只在本机：会话被导入到 `~/.agentsview/sessions.db`，网页只监听 `127.0.0.1`，
不会上传到任何地方。

## 一、安装(macOS，约 5 分钟)

前置：Go、Node、Xcode 命令行工具。没有的话：

```bash
brew install go node
xcode-select --install
```

然后：

```bash
git clone https://github.com/phronesis-io/agentsview.git
cd agentsview
./phronesis/install.sh
```

脚本做三件事：

1. 编译(前端 + 后端打成一个可执行文件)，装到 `~/.local/bin/agentsview`
2. 把本机已有的会话全量导入一次
3. 装一个 launchd 后台任务(见第三节)

装完打开 **http://127.0.0.1:8080** 。

## 二、怎么用

- 左侧是会话列表，可以按 agent(Codex / Claude …)、项目、时间筛选
- 顶部搜索框是全文搜索，能搜到命令和命令输出里的内容
- 会话里每个工具调用是一个可折叠的块：标题栏是 `$ 具体命令`，
  展开能看到完整脚本和输出(它实际读到的内容)

## 三、后台是怎么持续导入的

网页、API、导入是**同一个进程**(`agentsview serve`)。它自带文件监听，但我们实测
它会漏掉 Codex 正在进行中的会话的新内容，而且空闲一段时间后这个进程会自己退出。

所以安装脚本加了一个 launchd 任务 `io.phronesis.agentsview.sync`：

- 每 60 秒执行一次 `agentsview sync`(增量导入，通常 1-3 秒)
- 如果服务进程没在跑，`sync` 会顺带把它拉起来 —— 所以重启电脑后不用管，
  一分钟内网页自己恢复
- 日志在 `/tmp/agentsview-sync.log`

常用命令：

```bash
agentsview serve status          # 服务在不在、地址是什么
agentsview sync                  # 立刻手动导入一次
agentsview sync --full           # 全量重新解析(升级解析器后用)
launchctl print gui/$(id -u)/io.phronesis.agentsview.sync | grep -E "runs|last exit"
./phronesis/uninstall.sh         # 卸载(保留 ~/.agentsview 数据)
```

Linux 上脚本只负责编译安装，不装后台任务：自己常驻 `agentsview serve`，
再用 cron/systemd 每分钟跑一次 `agentsview sync` 即可。

## 四、升级

```bash
git pull
./phronesis/install.sh     # 重新编译 + 全量重新解析 + 重装后台任务
```

## 五、这个 fork 和上游的区别

| 分支 | 用途 |
|---|---|
| `phronesis`(默认) | 团队集成分支 = 上游 `main` + 我们的补丁。大家都在这里协作 |
| `main` | 上游镜像，**不要在上面提交** |

目前我们自己的改动：

- **Codex「code mode」命令解析**
  (`internal/parser/codex_exec_script.go`)：新版 Codex 把每次工具调用包成一段
  JavaScript(`text(await tools.exec_command({cmd:"..."}))`)，上游当 JSON 解析失败，
  界面上看不到具体命令，输出也是多层转义的 JSON。补丁把真实命令抽出来、把输出摊平成纯文本。
- `phronesis/` 目录：本说明和安装脚本。团队自己的东西尽量都放这个目录，
  减少和上游的合并冲突。

### 协作约定

- 改动走分支 + PR，合进 `phronesis`
- **这个仓库是公开的**(GitHub 不允许把公开仓库的 fork 设为私有)：
  代码、提交信息、测试样例里不要出现真实会话内容、内部路径、业务信息；测试用合成数据
- 改了解析器要带测试：`go test -tags fts5 ./internal/parser/`

### 同步上游(维护者)

```bash
git remote add upstream https://github.com/kenn-io/agentsview.git   # 只需一次
git fetch upstream main
git checkout phronesis && git merge upstream/main
go test -tags fts5 ./internal/parser/
git push origin phronesis
git push origin upstream/main:main        # 顺手把 main 镜像也更新
```
