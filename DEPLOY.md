# 发布与飞书注册

GitHub Pages 从 main 分支根目录发布，HTML 和同目录模块、CSS、sdk 必须一起提交。

正式地址：<https://jasinghuang.github.io/feishu-schedule-plugin/schedule-plugin.html>

当前仅接入 v2 Base `DI51bcg1raS4hasSykacHyRQnrd`，其他 Base 会拒绝连接，避免写错表。

在 v2 Base 右上角「插件」→「自定义插件」中使用上述地址；已有相同地址只需重新打开或刷新插件。按原有摄影师权限使用，不新增主播访问或公开数据分享。

发布前运行 `node --test tests/schedule.test.mjs`，通过本地合成预览核对列表、矩阵和编辑。发布后核对 GitHub Pages 构建与所有模块 200，再在 v2 内验证真实连接和上周 4 场 59 条。

不得提交真实记录备份、访问令牌、账号缓存或 `.DS_Store`。Base 快照和验收截图保存在工作区的 `output/feishu-schedule/`，不放入公共仓库。
