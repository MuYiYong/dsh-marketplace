# DSH Marketplace

MuYiYong 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件索引。DSH 的 **插件 → 发现** 页面读取本仓库的 `index.json`，用来展示、安装与更新插件。

## 索引地址

```text
https://raw.githubusercontent.com/MuYiYong/dsh-marketplace/main/index.json
```

## 在 DSH 中使用

1. 打开 **插件** 页，进入 **发现** 标签。
2. 点 **添加索引源**，粘贴上面的索引地址并确认。之后可以用工具栏的 **管理索引源…** 维护。
3. 在列表中选中插件，点 **安装**。安装对话框会显示条目来源、固定 commit 和注册表信息。
4. 从 Git 提交安装的副本，之后可以在 **发现** 页（卡片或详情页版本列表）点 **更新**；从 npm 安装的副本走「已安装」页的注册表更新。

## 已收录插件

| 插件 | 包名 | 源码仓库 | 说明 |
|------|------|----------|------|
| Codex Agent | `dsh-codex-agent` | [dsh-remote-codex-monitor](https://github.com/MuYiYong/dsh-remote-codex-monitor) | 在侧栏监控远端 Codex CLI 会话，定位 tmux 窗格、显示实时状态，并可在 iTerm2 中打开会话。 |

## 仓库结构

```text
index.json                    插件索引（DSH plugin market index format 1）
scripts/marketplace.mjs       格式校验、SemVer 比较、发版记录逻辑
scripts/validate-index.mjs    校验 CLI（CI 与本地都用它）
scripts/add-release.mjs       发布/更新条目的 CLI
test/marketplace.test.mjs     校验器与发版逻辑测试
.github/workflows/validate.yml CI：跑测试并校验索引
```

## 索引格式（format 1）

完整规则由 DSH 安装中的 `@deepseek-ai/dsh-plugin-market-index` 定义，下面是本仓库用到的要点：

- 根对象：`format: 1`、`title`、可选 `description`、可选 `metadata`、`plugins`。
- 所有展示文本支持本地化：字符串或 `{ "en": "...", "zh": "..." }`，对象必须含 `en`。
- `metadata.categories` / `metadata.labels` 定义条目可引用的分类与标签；`metadata.sortKeys` 定义可排序的数值键。
- `plugins[]`：`name`（npm 包名）、可选 `title/description/icon/author/homepage/repository`、`metadata`、非空 `versions`。
- `versions[]`：
  - `version`：精确 SemVer；`publishTimestamp`：整数 Unix 秒。
  - `source` 二选一：
    - `{ "type": "git", "url": "https://github.com/owner/repo", "commit": "<40 位小写 SHA>", "path": "可选包目录" }`
    - `{ "type": "npm", "registry": "可选 https 注册表" }`
  - 可选 `engines.dsh`：插件兼容的 DSH 版本范围。
- 图标：内联 data URL（SVG/PNG/JPEG/WebP，解码后 ≤32 KiB），或相对索引 URL 的引用（必须解析到 https 或同源）。

Git 条目的安装 spec 由 DSH 计算为 `git+<url>.git#<commit>`（子目录追加 `&path:/<dir>`），所以**索引里的 commit 必须真实存在且由 GitHub 可达**。

## 维护规则

### 插件仓库的要求

一个可被本索引收录的插件仓库至少需要：

- `package.json`：`name`、SemVer `version`、`dsh.bundle.patch`、可选 `dsh.client`、`engines.dsh`；
- `cordis.patch.yml`：声明要插入的 Host 行；
- `locale/en.json` + `locale/zh.json`：`meta.title` / `meta.description`，可选 `meta.detail`；
- `icon.svg`；
- 测试与 CI（建议 Ubuntu + macOS 都跑）；
- 可选 `docs/DETAIL.md`：市场详情页展示的介绍文档。

### 发布新版本（已有插件）

在插件仓库完成代码、测试与 `CHANGELOG` 后：

```sh
# 1. 插件仓库：更新 package.json version，提交并打标签
git tag v0.2.0
git push origin main --tags
git rev-parse HEAD   # 记录 40 位 commit

# 2. 本仓库：记录版本并校验
node scripts/add-release.mjs \
  --name dsh-codex-agent \
  --version 0.2.0 \
  --commit <完整 40 位 commit>

npm test
git add index.json
git commit -m "release: dsh-codex-agent 0.2.0"
git push
```

推送后 DSH 的发现页刷新即可看到新版本；Git 安装的副本可以点 **更新**。

可选参数：`--engines-dsh "^0.2.2-rc.5"`（不传时继承上一版本）、`--timestamp <Unix 秒>`（不传用当前时间）、`--path <包目录>`（包不在仓库根时必填）。

### 收录新插件

第一次收录时提供条目的展示信息；之后同一插件只需 `--name/--version/--commit`：

```sh
node scripts/add-release.mjs \
  --name dsh-my-plugin \
  --version 0.1.0 \
  --commit <40 位 commit> \
  --git-url https://github.com/MuYiYong/dsh-my-plugin \
  --title-en "My Plugin" --title-zh "我的插件" \
  --description-en "What it does." --description-zh "功能说明。" \
  --author MuYiYong \
  --homepage https://github.com/MuYiYong/dsh-my-plugin \
  --category developer-tools \
  --keywords codex,tmux \
  --labels codex,tmux \
  --engines-dsh "^0.2.2-rc.5"
```

`--category` / `--labels` 必须已在 `index.json` 的 `metadata` 中声明；新增分类或标签直接编辑 `index.json` 并跑校验。

### 本地校验

```sh
npm run validate   # 只校验 index.json
npm test           # 校验器与发版逻辑测试 + CI 同款检查
```

- `--file <path>`：校验其它索引文件。
- `--base-url <url>`：Fork 后相对图标按你的索引地址解析（默认本仓库的 raw 地址）。

## 兼容性与更新约束

- `engines.dsh` 范围必须包含当前 DSH 版本，否则发现页会把该版本标为不兼容、默认版本可能不可安装。
- 索引里的版本号应与插件 `package.json` 的版本一致；DSH 安装时以真实 manifest 为准，但市场展示和「有新版本」判断使用索引。
- Git 更新只对「安装 spec 固定到完整 commit，且仓库与 `path:` 目录和索引一致」的副本生效；移动包目录后老副本需要先卸载再安装。
- 只支持 Git 更新：npm 来源的更新走注册表版本列表，不由本索引驱动。
- 索引 URL 必须是无凭据、无片段、无重定向的 http(s) 地址；DSH 每次读取整份索引，插件很多时应拆分为多个索引仓库。

## 安全说明

- 索引没有签名：条目内容（名称、版本、commit）是索引方的声明，实际安装的内容取决于对应仓库与包 manifest。只收录可信来源。
- 远程图标 URL 会让浏览器向图片主机暴露用户的 IP；本仓库默认使用内联 data URL 图标。
- 安装前 DSH 会显示来源、固定 commit 等确认信息；请核对后再安装。

## License

[MIT](LICENSE)
