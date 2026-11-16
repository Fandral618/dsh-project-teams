# UI evidence

Two kinds of evidence live here, because the desktop window could not always be photographed.

## Pixel screenshots (real DSH Desktop window)

| File | Tab |
| --- | --- |
| `01-overview.png` | 总览 |
| `02-team.png` | 团队 |
| `03-tasks.png` | 任务 |
| `04-delivery.png` | 交付 |
| `05-messages.png` | 消息 |
| `06-decisions.png` | 决策 |
| `07-settings.png` | 设置 |
| `08-workbench-tabs.png` | 标签行，显示新增的 **时间线** 与 **质量** |
| `10-workspace.png` | v1.1 工作台：左项目/团队、画布（真实节点与连线）、右 Inspector、底部时间线 |

Method: the window bitmap was captured with `PrintWindow` (the RDP session's screen DC was
invalid, so `CopyFromScreen` fails), and tabs were switched with UI Automation
(`InvokePattern`) because mouse input does not reach a disconnected session. Only read-only
navigation was performed — no button that changes state was clicked.

## Recorded values for the two newest tabs

`09-quality-metrics.json` records the live numbers the 质量 tab renders, read from the running
Host through the same service the panel calls (`pt_owner dashboard`). The tab is visible in the
tab row of `08-workbench-tabs.png`; its rendered table could not be photographed after the
session disconnected, and its data path is covered by the dashboard tests
(`tests/integration/engine.test.js`).

The 时间线 tab is covered the same way: `timeline.get` is exercised by the timeline test, and the
tab is present in the live tab row.
