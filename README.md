<p align="center">
  <img src="https://raw.githubusercontent.com/demigodmode/pi-web-agent/main/docs/public/pi-web-agent-banner.png" alt="pi-web-agent: bounded web research for Pi" width="100%">
</p>

# pi-web-agent

<p align="center">
  <a href="https://github.com/demigodmode/pi-web-agent/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/demigodmode/pi-web-agent/ci.yml?branch=main&style=flat-square&logo=github&label=CI" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@demigodmode/pi-web-agent"><img src="https://img.shields.io/npm/v/@demigodmode/pi-web-agent?style=flat-square&logo=npm&logoColor=white&color=CB3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@demigodmode/pi-web-agent"><img src="https://img.shields.io/npm/dm/@demigodmode/pi-web-agent?style=flat-square&color=0A7BBB&label=downloads" alt="npm downloads"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-475569?style=flat-square" alt="Platform: macOS, Linux, Windows">
  <a href="https://demigodmode.github.io/pi-web-agent/"><img src="https://img.shields.io/badge/docs-github%20pages-2088FF?style=flat-square&logo=readthedocs&logoColor=white" alt="Docs"></a>
  <a href="https://github.com/demigodmode/pi-web-agent/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@demigodmode/pi-web-agent?style=flat-square&color=6F42C1" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/search%20backends-475569?style=flat-square" alt="Search backends">
  <img src="https://img.shields.io/badge/DuckDuckGo-475569?style=flat-square&logo=duckduckgo&logoColor=white" alt="DuckDuckGo">
  <img src="https://img.shields.io/badge/SearXNG-475569?style=flat-square&logo=searxng&logoColor=white" alt="SearXNG">
  <img src="https://img.shields.io/badge/degoog-475569?style=flat-square&logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAFjUlEQVRYw41Xa2xURRT%2Bztzd7kKBFlqoFCEtaqgEpQqIgUaI%2BsNEHqImxpAYDZGY6L%2FCjwYDQbBGqCRqSMAQjSYmigk%2FNEpiUIKCpYUCATQ8quFhCLbp9rF97e6d%2Bfyxrzv33m04P3Znzsyc75w5r7kCD0nun545Pf%2BGVAIsBPA4iHkUVOXO9GqtbzjK6RIlVzERCSAUUFgEmnA3ANI8TJpPSd5hCBl7epPkHpLzA6aJ3BNegUjOJfmtMcaYcLAcx%2Fj4hsYYl%2BTnyWRyVqjwUJZY4BtJDpH3YDNt9YzN7iXNmlI6hBLJ3caPY4KAXtZY2rCje5wd3Sl2dKeYGNbe3Zpkc9gVRIpDAUGQbAXQIn6NC2MWJsVlIjFssOvIaIHTsq4cKxaUASAEogC0aa3pOM4%2BrwqqKIJwXfc1AC2euwgZic1gFiLgSvHtB6CU2uu67vNe%2BUUFyDrHcfbbuSG%2BkUchKS4EbsuXXp6pchznC5LV%2Bf3Kc%2FYjAlPCIyWfs0Xr%2FTWjPD2Exp5TEJoAsk%2FiTAC782tKsgWmEcAG8WtfGEvJCM6zyzNJvHVxJ7a3b8b8gT9D4sZjC7lpbGysDgAiuaW3i5FFT%2BHwnBeAmTTG239D%2Bq%2BLMMlBAAKnZjYmNT0NicUAALWjt9DctQVlGw4CXGzLy8kXSCQej78JYFvk%2BPFfIwBeCottr5mp853o37cLuvduwMfJrw8htmxlQVeHGhWpRDE4GAxKgq8A2BZpampaBmC6AL6NRRo%2F8wf6djQDWufDGbFHl0BNnYbxcx3gyAhSZ055ADwpYrnPa6Y8QMP6iFLOkmK0BNHN6Aj623YC2s1mV%2BV0VO3ch7KGRdn14UEkWt9Fqut0iL%2FFcgEhln3amKUKQJ0vcUGPjP6fj8IMJAo3OaPlfZQ1LAJzUGpKBaq270Wk9v4SEepLZU8TFMF8pZSq8jvVexEf9K3Aj3M2wEUE0QcXINa4rCCsUAricZS%2FuLHAVJNdRGrGUYry5xRUZcSXLxZlNHH5LnC%2B7nUcm70G7ywexKzCA4GWpvGlT2KQgDMzhYr1%2F8KZlimNnpehIBFjTEKUsvh5SiQNXJ31XCJWjURdvcds%2B0SkphZT1%2FYgtiABUcSEr42cDGPMoFJK3ZQSCTCWMRY3FnWKcQJfD1AK8UcMRBkbpYQezPaGvxWAc4C%2FtGbFRx2xzme03ZKs8k8AdINmSKAQFkp5KpU6rwh0khwq7Ge%2B0wiqpzpwPPJ6BnTpW%2BUwoJM2kD%2Fq7EJ7Ix6PX1dKJE3ySJhpsaigflY0K9AZxLm%2B9sA15n%2F1wBmEY7JUgz2MbDcUaK33%2B8Xm6amFMWQqj2Js7nu4kD6Ey71XQ2QB2y91YXPvCnwzXI9hE%2FFIC21kbiqVOphTgCgrKzsL4nsGxAJrn3AQv%2B8kIC4AYMfJj3FnuMfqlIev%2FITjtzpwLVOBA0MNeLVnNa5lpoVIy5Ix%2Bst4PP6PtZ57Rl8CMNm%2BDcGJ253YdqINJlciy6OTsO6hZzFnag1%2Bv30WHXcu%2BE4Arau2YNW85bYrsrM%2BAAtFpMcfyHBdvclx1CHbz9k68MvNdnx4%2BgCG06MBiwigdko1ekf64TIbqK2rtmD1vOX%2BBCeA9SLyQzH1cyORbCpprduUqOawu%2BsfG8L33cdw9u4l9Iz2AQSqJlVieW0jXm54Dt9dOQptsgo8U7cSdRVz%2FCK2iqg269vLj0NStNZ7rI%2BM0E%2BR4JPd5gd2bMXEJNabwXXdN0gmwxQp%2FZWUZ1pqJFztvhDIQ5lQlXy%2FYR3JI2FYoeA2aZJfjYyMzC62ZZkYtBSlM%2BnHtHY%2FI9lngg6w3WDMf1rrT1KpVMO9YJTEFd%2BjOPuaNRFAlhhjliql6o0xM5RSMMb0Q6nrOpPpjEajF0TEYCLyCP8fKAkkA5CrUVoAAAAASUVORK5CYII%3D" alt="degoog">
  <img src="https://img.shields.io/badge/Brave-475569?style=flat-square&logo=brave&logoColor=white" alt="Brave Search">
  <img src="https://img.shields.io/badge/You.com-475569?style=flat-square&logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8%2F9hAAABZElEQVQ4jX2TP0sDQRDF3ywbcROCF8HKQgstUiWFX8BWm4BYaJVGERE89AuYzkY4mxQ2WqUQBBtt%2FQIpEhsbG%2Btg%2FiDehhB2LBLD5TKXBwsD835v2dldgqCS3%2FEWh%2B6cAB8AGAj6Wt0%2BB7lu3EtzQC%2Fm7UpBNA%2Fc2zEAgKdXmxhEh6edIiv3JuyYFDAJIqe2tVPugQQYANZWNULrpBYAeEzuXhNQkLppQ8hv6nEdIrQ8ayIUVRJ8cZRFxhAy4zptSLKCDs6%2BGRidlxlYWVbYKiwgEwN%2BLaPeHKDVnj6Snkqj8ZJ2ivTFgOik0ybE5XEW%2BY1R%2B%2BNziJu7H3EO4gxCyxMgWkvSDDSlmwgto%2F4%2BmNSSGGgq5VSZGT3J0Gq7maFF6C%2FlVFnVqrlGP6XWGagkBU1xjB4DFZtSxVo115A%2Bkw%2BGT4Sl6FNmRg%2BEoK9VMPOZ4ir5Hc8M3dX%2BrjkBgMcXex0H%2F%2FUHatWr2uEU4ZoAAAAASUVORK5CYII%3D" alt="You.com">
  <img src="https://img.shields.io/badge/Exa-475569?style=flat-square&logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACgUlEQVR42u2XXUiTYRTHf8%2Feuem7V6sbQcFMsgyJQoigizDqIuhDiW6iksBISrGS7MsP3JhWlBUqWnThjX2RBGlSRCREF0UEkURkGWYSUhCpe7e5ue3pQmaY6Eq3hNq5ex8O5%2Flxzvn%2FeR%2BRuu6bZA7DwBxHFCAKYAyVUF%2Bhkb06ZkbFS07pdD4bnR2AGieYFy8YdEhudHhCXmo2wZ5tsSgG0F1y9h0Ixvx4QW%2B%2Fn1v3p4ewH7agGOB6h4fnXb7w7ICU0NPnx3ZIZUmqMmXexrUm8nLNvOnxY2twhW8JpYQim44AGq0acWYxKScp0cCZUgtOl6TYruPxyvCqoLvXT80lF0sXKVQUqhPnqEBDpcaCBMHRs04%2BfPJHRoYtbR7udnrZlWMmZ4Np%2FPxIvsqq5Uaab49w77E3sj5QftFJ%2F0CAmhILKUkG1mTFULAjlldvfZy%2B7Aq%2FD%2Fwaw7rkYLVOa10CjVUayYkGHE5JoVVn1EdkAISAq7XxE850t2RFhhEpYW%2BZg89fAv%2BoFQdluLvUMf6dlWmktS6Brm4fyYkGLpRpbN43NKMu%2FHEHEjRBfYWG2yMpsukU253EWwRNVo0Y418YQXD7g2p4%2BnKUKzdHWLnMyMn9amQB8nLNbF1v4lq7h%2FZHP%2FV%2BvtnFi9c%2B8rfHsinbFBmAjDSF8gMq7z76qW6aqHefH4rtOt%2BHJeeOWVi8UAkvgBDQWKUhgSKrjtsz2ecHvgY4UevEogoaKjXMJhFegPRUhao6F%2B%2F7pvb5B0%2B8tLR5yExXqCpWw%2BuEgw5JWorC8YLpC4%2F6JP4A7Nxi5s7D0P8EIQFcbsmQQyIYK%2Fo7oTvHRqSpoccgoi%2BjKMB%2FD%2FADRpbjdBgK8S0AAAAASUVORK5CYII%3D" alt="Exa">
  <img src="https://img.shields.io/badge/Tavily-475569?style=flat-square&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1NSA1NSIgd2lkdGg9IjU1IiBoZWlnaHQ9IjU1Ij4KPHBhdGggZD0iTTM4LjgwODggMEM0NC40NzYyIDAgNDcuMzEwMSA5LjE4OTVlLTA1IDQ5LjQ3NDggMS4xMDMwNkM1MS4zNzg4IDIuMDczMjYgNTIuOTI3IDMuNjIxMzUgNTMuODk3MSA1LjUyNTQ0QzU1LjAwMDEgNy42OTAxMyA1NSAxMC41MjQgNTUgMTYuMTkxNFYzOC44MDg4QzU1IDQ0LjQ3NjEgNTUuMDAwMSA0Ny4zMDk5IDUzLjg5NzEgNDkuNDc0NkM1Mi45MjcgNTEuMzc4NiA1MS4zNzg4IDUyLjkyNjcgNDkuNDc0OCA1My44OTY5QzQ3LjMxMDEgNTQuOTk5OSA0NC40NzYyIDU1IDM4LjgwODggNTVIMTYuMTkxNEMxMC41MjM5IDU1IDcuNjkwMTQgNTQuOTk5OSA1LjUyNTQ0IDUzLjg5NjlDMy42MjEzMyA1Mi45MjY3IDIuMDczMjUgNTEuMzc4NyAxLjEwMzA2IDQ5LjQ3NDZDMC4wMDAxMDk5NTggNDcuMzA5OSAwIDQ0LjQ3NjIgMCAzOC44MDg4VjE2LjE5MTJDMCAxMC41MjM4IDAuMDAwMTA3NjE0IDcuNjkwMTIgMS4xMDMwNiA1LjUyNTQ0QzIuMDczMjUgMy42MjEzMyAzLjYyMTMzIDIuMDczMjYgNS41MjU0NCAxLjEwMzA2QzcuNjkwMTQgOC44ODQzNmUtMDUgMTAuNTIzOSAwIDE2LjE5MTQgMEgzOC44MDg4WiIgZmlsbD0iIzFGMUUxRSIvPgo8cGF0aCBkPSJNMjMuMzg2MyAzMC40MDVDMjMuMDg4NSAzMC40MDUgMjIuNzkzNCAzMC40NjM4IDIyLjUxODMgMzAuNTc4MkMyMi4yNDMzIDMwLjY5MjYgMjEuOTkzMyAzMC44NjAzIDIxLjc4MjcgMzEuMDcxNkwxNy40NTM0IDM1LjQxODhMMTYuMzAyOSAzNC4yNjM4QzE1LjQ1NzMgMzMuNDE1IDE0LjAwOTkgMzMuODM0NiAxMy43NDcxIDM1LjAwNjRMMTIuMTA3MyA0Mi4zMDIzQzEyLjA0OTggNDIuNTUzMiAxMi4wNTY4IDQyLjgxNDggMTIuMTI4IDQzLjA2MjFDMTIuMTk5IDQzLjMwODUgMTIuMzMxMyA0My41MzI3IDEyLjUxMjMgNDMuNzEzNkwxMi41MTA4IDQzLjcxNTlDMTIuNjkxNSA0My44OTg3IDEyLjkxNTUgNDQuMDMyMSAxMy4xNjE5IDQ0LjEwMzdDMTMuNDA4MyA0NC4xNzUyIDEzLjY2ODggNDQuMTgyNCAxMy45MTg4IDQ0LjEyNDZMMjEuMTg2MiA0Mi40Nzc2QzIyLjM1MjcgNDIuMjEzNyAyMi43NzE1IDQwLjc2MTQgMjEuOTI1OSAzOS45MTI0TDIwLjc3NTQgMzguNzU3NEwyNS4xMDU2IDM0LjQxMUMyNS41MzA2IDMzLjk4NDIgMjUuNzY5NSAzMy40MDQ5IDI1Ljc2OTUgMzIuODAxM0MyNS43Njk1IDMyLjE5NzcgMjUuNTMwNiAzMS42MTg1IDI1LjEwNTYgMzEuMTkxNkwyNS4wNDc2IDMxLjEzMzRMMjUuMDQ5NyAzMS4xMzE5TDI0Ljk4OTYgMzEuMDcxNkMyNC43NzkxIDMwLjg2MDMgMjQuNTI5IDMwLjY5MjYgMjQuMjU0IDMwLjU3ODJDMjMuOTc5IDMwLjQ2MzggMjMuNjg0IDMwLjQwNTEgMjMuMzg2MyAzMC40MDVaIE0zOS4wMDU0IDI3LjY2NjNDMzcuOTk0MSAyNy4wMjQ1IDM2LjY3NjggMjcuNzU0NiAzNi42NzY2IDI4Ljk1NTZWMzAuNTg4NEgyNy4zOTgxQzI3LjcwODEgMzEuMTgzMiAyNy44ODQ3IDMxLjg1OTYgMjcuODg0NyAzMi41Nzc0QzI3Ljg4NDYgMzMuNjE1MiAyNy41MTgxIDM0LjU2NzIgMjYuOTA4IDM1LjMwOTlMMzYuNjc1OCAzNS4zMDk2TDM2LjY3NTIgMzYuOTQyNEMzNi42NzUzIDM4LjE0MzQgMzcuOTk0MSAzOC44NzM2IDM5LjAwNTQgMzguMjMxOUw0NS4zMDQ1IDM0LjIzODdDNDUuNzc1NyAzMy45Mzg0IDQ2LjAxMTQgMzMuNDQzIDQ2LjAxMTUgMzIuOTQ4QzQ2LjAxMDkgMzIuNDUzNiA0NS43NzUyIDMxLjk1OTIgNDUuMzAzIDMxLjY2MDFMMzkuMDA1NCAyNy42NjYzWiBNMjMuNjEwNCAxMC4yMjA2QzIzLjM1MzkgMTAuMjE5NCAyMy4xMDEgMTAuMjgzOSAyMi44NzYzIDEwLjQwODFDMjIuNjUxNCAxMC41MzI1IDIyLjQ2MTQgMTAuNzEzMiAyMi4zMjUzIDEwLjkzMThMMTguMzQ3MiAxNy4yNTQ5SDE4LjM0NThDMTcuNzA2NyAxOC4yNzAxIDE4LjQzNDYgMTkuNTkzMyAxOS42MzA3IDE5LjU5MzZIMjEuMjU3OFYyOC45ODY5QzIxLjkzMjcgMjguNTQwNiAyMi43NDAzIDI4LjI4MDEgMjMuNjA5IDI4LjI4MDFDMjQuNDc4MSAyOC4yODAxIDI1LjI4NjQgMjguNTQwNyAyNS45NjE1IDI4Ljk4NzVWMTkuNTkzNkgyNy41ODg0QzI4Ljc4NDkgMTkuNTkzNiAyOS41MTEyIDE4LjI3MDIgMjguODcyOCAxNy4yNTQxTDI0Ljg5MzkgMTAuOTMxOEMyNC41OTUxIDEwLjQ1ODQgMjQuMTAyOSAxMC4yMjEyIDIzLjYxMDQgMTAuMjIwNloiIGZpbGw9IiNGRkZDRjYiLz4KPC9zdmc%2BCg%3D%3D" alt="Tavily">
  <img src="https://img.shields.io/badge/Parallel-475569?style=flat-square&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMjcxIiBoZWlnaHQ9IjI3MCIgdmlld0JveD0iMCAwIDI3MSAyNzAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BCjxwYXRoIGQ9Ik0yNjcuODA0IDEwNS42NUgxOTMuODI4QzE5NC4wMjYgMTA2LjgxNCAxOTQuMTg3IDEwNy45OTYgMTk0LjM0OSAxMDkuMTc4SDc2LjY3MDNDNzYuNDU0NiAxMTAuNzM2IDc2LjIzODggMTEyLjMxMiA3Ni4wNTkxIDExMy44N0gxLjYzMzQyQzEuMjczODcgMTE2LjE5OCAwLjk1MDI4OSAxMTguNTQzIDAuNjk4NjA4IDEyMC45MjVINzUuMzc1OUM3NS4yNTAxIDEyMi40ODMgNzUuMTYwMiAxMjQuMDU5IDc1LjA3MDMgMTI1LjYxN0gxOTUuOTQ5QzE5Ni4wMDMgMTI2Ljc4MSAxOTYuMDU3IDEyNy45NjIgMTk2LjA5MyAxMjkuMTQ0SDI3MC42OFYxMjUuMzg0QzI3MC4xOTUgMTE4LjY1MSAyNjkuMjQyIDExMi4wNjEgMjY3LjgwNCAxMDUuNjVaIiBmaWxsPSIjRkZGRkZGIi8%2BCjxwYXRoIGQ9Ik0xOTUuOTQ5IDE0NC40MDFINzUuMDcwM0M3NS4xNDIyIDE0NS45NzcgNzUuMjUwMSAxNDcuNTM1IDc1LjM3NTkgMTQ5LjA5M0gwLjY5ODYwOEMwLjk1MDI4OSAxNTEuNDU3IDEuMjU1OSAxNTMuODAyIDEuNjMzNDIgMTU2LjE0OEg3Ni4wNTkxQzc2LjIzODggMTU3LjcyNCA3Ni40MzY2IDE1OS4yODIgNzYuNjcwMyAxNjAuODRIMTk0LjM0OUMxOTQuMTg3IDE2Mi4wMjIgMTk0LjAwOCAxNjMuMTg2IDE5My44MjggMTY0LjM2N0gyNjcuODA0QzI2OS4yNDIgMTU3Ljk1NyAyNzAuMTk1IDE1MS4zNjcgMjcwLjY4IDE0NC42MzRWMTQwLjg3NEgxOTYuMDkzQzE5Ni4wNTcgMTQyLjA1NSAxOTYuMDAzIDE0My4yMTkgMTk1Ljk0OSAxNDQuNDAxWiIgZmlsbD0iI0ZGRkZGRiIvPgo8cGF0aCBkPSJNMTkwLjYyOCAxNzkuNjQySDgwLjM1NTlDODAuNzUxNCAxODEuMjE4IDgxLjE4MjggMTgyLjc3NiA4MS42MTQzIDE4NC4zMzRIOS4zMDk5NEMxMC4yNDQ4IDE4Ni43MTUgMTEuMjUxNSAxODkuMDYxIDEyLjMxMjEgMTkxLjM4OUg4My43NTM2Qzg0LjI3NDkgMTkyLjk2NSA4NC43OTYyIDE5NC41MjMgODUuMzUzNSAxOTYuMDhIMTg1LjU5NEMxODUuMTYzIDE5Ny4yNjIgMTg0LjczMiAxOTguNDI2IDE4NC4yODIgMTk5LjYwOEgyNTQuNTE5QzI1OC42IDE5Mi4xNzcgMjYxLjk4IDE4NC4zMTYgMjY0LjYwNCAxNzYuMTE0SDE5MS40NTVDMTkxLjE4NSAxNzcuMjk2IDE5MC44OTggMTc4LjQ2IDE5MC42MSAxNzkuNjQySDE5MC42MjhaIiBmaWxsPSIjRkZGRkZGIi8%2BCjxwYXRoIGQ9Ik0xNzcuNjY2IDIxNC44ODNIOTMuMzM1MkM5NC4xMDgyIDIxNi40NTggOTQuOTE3MiAyMTguMDM0IDk1Ljc0NDEgMjE5LjU3NEgyOS44NzU2QzMxLjgzNTEgMjIxLjk5MiAzMy44NjY2IDIyNC4zMzcgMzUuOTY5OSAyMjYuNjNIOTkuNjYzMkMxMDAuNTk4IDIyOC4yMDUgMTAxLjU1MSAyMjkuNzgxIDEwMi41MjIgMjMxLjMyMUgxNjguNDk4QzE2Ny43NjEgMjMyLjUwMyAxNjcuMDA2IDIzMy42ODUgMTY2LjIzMyAyMzQuODQ5SDIyNi43NjJDMjM0LjQ3NCAyMjcuODQ3IDI0MS4zNiAyMTkuOTUgMjQ3LjI5MiAyMTEuMzU1SDE3OS4zNTZDMTc4Ljc5OSAyMTIuNTM3IDE3OC4yNiAyMTMuNzE5IDE3Ny42ODQgMjE0Ljg4M0gxNzcuNjY2WiIgZmlsbD0iI0ZGRkZGRiIvPgo8cGF0aCBkPSJNMTU0Ljk0MyAyNTAuMTA2SDExNi4wNThDMTE3LjM3MSAyNTEuNjk5IDExOC43MDEgMjUzLjI1NyAxMjAuMDY3IDI1NC43OTdINzMuMDIxQzkxLjYwOTQgMjY0LjQzMSAxMTIuNzE1IDI2OS45NDYgMTM1LjA5NiAyNzBDMTM1LjI0IDI3MCAxMzUuMzY2IDI3MCAxMzUuNDkyIDI3MEMxMzUuNjE4IDI3MCAxMzUuNzYxIDI3MCAxMzUuODg3IDI3MEMxNjQuMDQgMjY5LjkxMSAxOTAuMTc4IDI2MS4yOCAyMTEuODA1IDI0Ni41NkgxNTcuNzQ4QzE1Ni44MTMgMjQ3Ljc0MiAxNTUuODc4IDI0OC45MjQgMTU0LjkyNSAyNTAuMDg4TDE1NC45NDMgMjUwLjEwNloiIGZpbGw9IiNGRkZGRkYiLz4KPHBhdGggZD0iTTExNi4wNTkgMTkuOTEyNEgxNTQuOTQzQzE1NS44OTYgMjEuMDc2NCAxNTYuODMxIDIyLjI1ODIgMTU3Ljc2NiAyMy40NDAxSDIxMS44MjNDMTkwLjE3OSA4LjcyMDY1IDE2NC4wNTggMC4wODk1MzQ0IDEzNS45MDYgMEMxMzUuNzYyIDAgMTM1LjYzNiAwIDEzNS41MSAwQzEzNS4zODQgMCAxMzUuMjQgMCAxMzUuMTE1IDBDMTEyLjcxNSAwLjA3MTYyNzUgOTEuNjI3NyA1LjU2OTA0IDczLjAzOTMgMTUuMjAyOUgxMjAuMDg2QzExOC43MTkgMTYuNzQyOSAxMTcuMzg5IDE4LjMxODcgMTE2LjA3NyAxOS44OTQ1TDExNi4wNTkgMTkuOTEyNFoiIGZpbGw9IiNGRkZGRkYiLz4KPHBhdGggZD0iTTkzLjMzNTYgNTUuMTUzMkgxNzcuNjY3QzE3OC4yNDIgNTYuMzE3MSAxNzguNzk5IDU3LjQ5OSAxNzkuMzM5IDU4LjY4MDhIMjQ3LjI3NEMyNDEuMzQyIDUwLjA4NTUgMjM0LjQ1NyA0Mi4xODg2IDIyNi43NDQgMzUuMTg3SDE2Ni4yMTVDMTY2Ljk4OCAzNi4zNTEgMTY3Ljc0MyAzNy41MzI4IDE2OC40OCAzOC43MTQ3SDEwMi41MDRDMTAxLjUzMyA0MC4yNzI2IDEwMC41OCA0MS44MzA1IDk5LjY0NTYgNDMuNDA2M0gzNS45NTIzQzMzLjgzMSA0NS42ODA0IDMxLjc5OTYgNDguMDI2MiAyOS44NTggNTAuNDYxNkg5NS43MjY1Qzk0Ljg5OTYgNTIuMDE5NSA5NC4xMDg2IDUzLjU3NzQgOTMuMzE3NiA1NS4xNTMySDkzLjMzNTZaIiBmaWxsPSIjRkZGRkZGIi8%2BCjxwYXRoIGQ9Ik04MC4zNzM2IDkwLjM3NThIMTkwLjY0NkMxOTAuOTMzIDkxLjUzOTggMTkxLjIyMSA5Mi43MjE2IDE5MS40OTEgOTMuOTAzNUgyNjQuNjRDMjYyLjAxNSA4NS43MDIxIDI1OC42MzYgNzcuODQxIDI1NC41NTUgNzAuNDA5N0gxODQuMzE4QzE4NC43NjcgNzEuNTczNiAxODUuMTk5IDcyLjc1NTUgMTg1LjYzIDczLjkzNzNIODUuMzg5M0M4NC44MzIgNzUuNDk1MiA4NC4yOTI3IDc3LjA1MzEgODMuNzg5MyA3OC42Mjg5SDEyLjM0NzlDMTEuMjg3MiA4MC45Mzg5IDEwLjI4MDUgODMuMjg0NyA5LjM0NTcgODUuNjg0Mkg4MS42NUM4MS4yMTg2IDg3LjI0MjEgODAuNzg3MSA4OC44IDgwLjM5MTYgOTAuMzc1OEg4MC4zNzM2WiIgZmlsbD0iI0ZGRkZGRiIvPgo8L3N2Zz4K" alt="Parallel">
  <img src="https://img.shields.io/badge/Keenable-475569?style=flat-square&logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAEX0lEQVRYw%2B3WTYyV1RkH8N95750vHaAodLSCVSlVUdoxUVMTXWj8qKJd2FRNHQyLGt01GE1rNOlCF0YTNVE3jWkroCYSjSHYEBeFGFumYkUiQURL%2BXAYR2bAMjMwX%2B97XNxzL3fgXkC3%2Bt%2Fc%2B55znvP8z3Oe538evsd3HaHpzD2RDFMn2WFVoCee3MPKcMLpo%2BiJRBXnEUEZs0TtaWQCwxgX0gh0YsSM9K%2BUqI8qDMvqvB1DZPrX0qhu09mi63E9utGVZgaxA%2BsEb4uGcDluTb%2FnowOj2ImNWCv4CLkcZawIxxCoOu8QjLoGf8C1abNGGMc%2F8Sluw49OcFF78RfBcxhyJMXpbyER6EnOWwUT7hQ9ifk186JyJW1lishk3sRNuo62lsRwclqcc8FreFC0T45XjyUQLcGfa6eJlMtccX60pDta0JUZHSv8Y%2Buk1e%2B3HUfkknO49TIunUeWsb0vt3rjhO1fTgvii1iOEYGSpbUMno8XcFHV%2BWltLP9l9PRvo1u6g8P73rPt3Vd9PNBq5%2Bh8RTLNAnf9ovDCMu66KvjZuZwR9tj975cMf%2FKawa8mHGlfSMjgYuxW2CyrpAOTaHFHSqJK1DLuvy760%2B1Be0uw6T8fevjhR3w21KFv4d3y9qNhv%2B2ywjM9UdesSrrvHzzgscefsGHDelkozG19X1E63cGZN0g5da%2FMW6KBikWrOfhNKj4ii%2BdFv78pam8hz3N%2FX7vGvr49puZcK28%2Fp%2BZ8zszooSV0zSrVYtzbu1Fv779kGSErKU0eNLv%2FReXJgeqSn%2BMayEREi3FhfTJdfWFwRmfm8AQHhyf1Dx4y1TLXcOeVR2sncuUFwcKzgsPjjI4zNkXfwP%2BN5S1iqVORnS4vdSqP9%2Bk4vK1q24GrtAohqdj96f6rkuHSeSz4YSWx87yw7ePtBvYfMNbZrSh11gicN5fF8wlJP0Kgb1%2B%2FT3bsEGO9QkYT7T8x0VYrrjXoKaePM%2Budw9a9bN1T%2FcrIFvGDOuVL5bVrP7u%2BPKYcw9nMOrtpmSbMRXtZM4QGQh1Pcd3Rtc0UoybOVQJDaXFJc3yGTbgxRawZRrA%2BqeRXTWhn6MehKoFd1ASyEdbhj%2Fgcq5NEN0K%2F4BHR6kTkpKgS2Io9WNRgzV48ii1JLd9rQiDHsw75qxl1o6uav%2Fj1d9GXTtYIa2U2172SazDQYN1uvG5GyolV4aTO6wlErMQHDU61RaGojQSb8HKDvf6H%2FTRvPhoTWBWqzcd%2FBY%2BjvqhCjeR4jeoknkmJVo%2FilL0eF4FqB5R5Ew%2Fgi7r5biUlbdPsPk8v2jt1Yz9FRaNP1KI1JFANWSHq8IrgPvSmU%2F1KXtHtaTUfbBHcg%2BdxAD%2FG71B5ppaeGonjW7Iqonm4OdX9FJ4y0wdGEq1Q6xnbRFfj11iINwQrMXIqudC4KZ2ODswWTAkGUVgRWBYZQ0uNSEk0G6fJDIlGvx2BZkRCXae8os5sWawUcVeDXb9BNXyP7y6%2BBrHOcOuuqEPxAAAAAElFTkSuQmCC" alt="Keenable">
  <img src="https://img.shields.io/badge/Google%20SERP-475569?style=flat-square&logo=google&logoColor=white" alt="Google SERP">
</p>

One public tool, `web_explore`, that does bounded web research for Pi: search, fetch, targeted browser rendering, ranking, and honest caveats, all behind a single call.

> Most agent web tooling blurs search, fetch, rendering, and synthesis into one vague thing. `pi-web-agent` keeps that boundary simple, and it is stricter about what it actually did: bot-check pages, narrow source sets, unreadable threads, and conflicting evidence show up as caveats instead of fake confidence.

## What you get

- **One tool.** `web_explore` handles direct links, discovery, HTTP reads, targeted headless rendering, source ranking, source-quality checks, and caveats internally.
- **Reads the real content behind links.** Paste a GitHub, PDF, or YouTube URL and it pulls the actual thing (GitHub files/issues/PRs from the API, PDF text, YouTube transcripts). Public GitHub content is keyless; private GitHub content needs `GITHUB_TOKEN` or `gh auth login`. So "summarize this PDF" or "what does this repo do" works off the source, not the page shell.
- **Answers questions about a GitHub repo from its code.** Paste a repo or folder link and it clones that exact commit (shallow, over HTTPS), searches the code for your question, and cites excerpts with links pinned to the commit. Needs `git` 2.32+. Public repositories can be read anonymously; private repositories use `gh auth login` or `GITHUB_TOKEN`. If the repo can't be read it says why instead of guessing from the README.
- **Esc stops it.** Cancelling a running `web_explore` stops searches, page reads, and the headless browser. Page reads give up after 15 seconds (PDFs 60, Firecrawl 45), and one page that fails to load doesn't fail the whole run.
- **Ten search backends.** DuckDuckGo (keyless default), SearXNG, degoog, Brave, You.com, Exa, Tavily, Parallel (keyless, opt-in), Keenable (opt-in), and any Google SERP endpoint you point it at.
- **Optional search fanout.** Query several backends at once, dedupe, and rank pages that more than one provider agreed on to the top. Off by default; flip it to `on` or `auto`.
- **Honest by default.** Weak, narrow, blocked, or cautionary evidence gets flagged instead of dressed up as confidence.
- **Safe with untrusted pages.** Links the model picks, or finds on a page it read, can't reach localhost, your LAN, or cloud metadata endpoints. That includes redirects and everything a headless page loads. Addresses you configure yourself aren't affected, and an allow list covers the private ranges you do want.
- **Guards against hostile pages.** Hidden text is removed, text that tells an AI agent to do something risky is marked, and queries containing credentials are refused. [What this covers and what it doesn't](docs/safety.md).
- **Fallback that knows why.** Rate-limited or misconfigured backends get skipped for a while, flaky ones get one retry, and answers say when some search backends were unavailable.
- **Presentation and result length are separate.** `compact` / `preview` / `verbose` control the terminal; Auto result length keeps the tool result suited to the calling model.
- **Zero-config to start.** Runs keyless out of the box (DuckDuckGo search, local browser, the built-in readers). Opt into hosted backends, fallback, search fanout, and per-tool output modes through config when you want more control.

## Why pi-web-agent

Compared to other web tooling for agents:

- **Hands-off.** No curator, no browser windows to approve, no step that pops you out of your session. Ask `web_explore` once and the answer comes back cleanly. Nothing to babysit.
- **Keyless by default.** Search, page reads, and the GitHub/PDF/YouTube readers all work with no API keys. Add hosted providers only when you want them.
- **Bounded and honest.** The terminal is compact by default; tool results use their own model-aware length limit and say when a read was not good enough instead of returning fake confidence.

## Install

> `pi-web-agent` requires Pi 0.74+ (Pi packages moved to the `@earendil-works/*` scope). Update Pi before updating this package. On older Pi, stay on `@demigodmode/pi-web-agent@0.6.x`. The extension works on Pi 0.99 and 1.0; `typebox` is a peer dependency that Pi already provides.

CI runs on Node 22. The locked runtime dependency `undici@8.10.2` declares Node `>=22.19.0`; see [installation requirements](https://demigodmode.github.io/pi-web-agent/install#requirements).

```bash
pi install npm:@demigodmode/pi-web-agent
```

Reload or restart Pi after installing, then:

```text
/web-agent doctor   # check it loaded and show configured backends
/web-agent          # action menu
```

Update later with `pi update --extensions`.

**Browser rendering:** headless first tries a detected Chromium-family browser (Chrome, Chromium, Edge, Brave). If none is found, it tries Playwright-managed Chromium, which must already be installed. See [browser setup](https://demigodmode.github.io/pi-web-agent/install#browser-rendering) for the matching install command. Firefox/Safari-only systems still get search and plain HTTP reads.

## Usage

Ask `web_explore` a web question:

> Find current docs and discussions on configuring Vitest coverage with the v8 provider.

Or hand it a link to read:

> Summarize this PDF: https://arxiv.org/pdf/1706.03762

If a pass comes back thin, call `web_explore` again with a narrower query.

Short, specific queries work best. Words like `vs`, a version number or `user opinions` change how the research runs, so they're worth keeping. Results also list what was searched, and when one comes back partial, what's still open plus a couple of follow-up searches Pi can try.

## Backends

Defaults are DuckDuckGo search, plain HTTP fetch, and local-browser headless. Switch providers from `/web-agent settings → Backends`. The UI does not write API keys. Manual Firecrawl `apiKey` and proxy `password` config values are supported, but a Backends save removes them from that scope's file. Environment variables survive those saves.

| Backend | Role | Enable with |
| --- | --- | --- |
| DuckDuckGo | search (default) | nothing, keyless |
| SearXNG | search (self-hosted) | base URL |
| degoog | search (self-hosted) | base URL, optional `PI_WEB_AGENT_DEGOOG_API_KEY` |
| Brave | search (hosted) | `PI_WEB_AGENT_BRAVE_API_KEY` |
| You.com | search (hosted) | `YDC_API_KEY` |
| Exa | search (hosted) | `EXA_API_KEY` |
| Keenable | search (hosted, opt-in) | `KEENABLE_API_KEY` |
| Tavily | search (hosted) | `TAVILY_API_KEY` |
| Parallel | search (hosted) | select `parallel`, keyless |
| Google SERP | search (hosted) | base URL + `PI_WEB_AGENT_GOOGLE_SERP_API_KEY` |
| Firecrawl | fetch (self-hosted) | base URL + `PI_WEB_AGENT_FIRECRAWL_API_KEY` |
| GitHub reader | content | public content is keyless; private content needs `GITHUB_TOKEN` or `gh auth login` |
| GitHub repo research | content | `git` 2.32+ on your PATH; `GITHUB_TOKEN` or `gh auth login` for private repos |

Full config shape (fallback, SearXNG/Firecrawl options, fanout): see the [self-hosted backends docs](https://demigodmode.github.io/pi-web-agent/self-hosted-backends).

## Settings

```text
/web-agent settings                    # main UI
/web-agent doctor                      # health check
/web-agent show                        # effective config
/web-agent changelog
/web-agent mode web_explore verbose    # per-tool presentation mode
/web-agent reset project | global
```

Config is JSON, and project config overrides global:

```text
Global:  ~/.pi/agent/extensions/pi-web-agent/config.json
Project: .pi/extensions/pi-web-agent/config.json
```

```json
{
  "results": { "lengthLimit": "short" },
  "presentation": {
    "defaultMode": "compact",
    "tools": { "web_explore": { "mode": "verbose" } }
  }
}
```

Presentation modes:

- `compact`: short summary, the default everywhere
- `preview`: slightly richer bounded view
- `verbose`: fuller bounded view

Modes change the terminal display only. They do not shorten the tool result the model receives. Result length controls that separately: Auto is the default, or choose Short (4,000 characters), Medium (8,000), Standard, or an exact number in JSON (numbers below 1,000 become 1,000). See [Result length](https://demigodmode.github.io/pi-web-agent/tools#result-length) for what is counted and the Standard source caps.

In Presentation or Backends settings, Ctrl+S saves, Esc discards edits, and Ctrl+R (pressed twice) resets the selected scope's whole config file. In Results, Ctrl+R resets only result-length settings for that scope. The explicit reset menu and `/web-agent reset project` or `/web-agent reset global` reset the whole scope file, including result-length settings.

## Docs

Full docs: <https://demigodmode.github.io/pi-web-agent/>. Work on them locally with `npm run docs:dev`.

## Development

```bash
npm install
npm test
npm run lint
npm run build
```

Local Pi work uses `.pi/extensions/pi-web-agent.ts`; run `/reload` after changes.

Feature and fix PRs target `develop`; `main` only moves on release. See [Releases](https://demigodmode.github.io/pi-web-agent/releases).

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
