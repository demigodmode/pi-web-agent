# Custom coverage reporters support

https://github.com/vitest-dev/vitest/issues/4150
2023-09-19T11:56:17Z

### Clear and concise description of the problem

Context: I'm planning to create custom istanbul reporter based on official html reporter.

Problem 1: Custom reporters config error:
Currently vitest allow only official istanbul reporters
![image](https://github.com/vitest-dev/vitest/assets/67923777/bcc8c31b-33ca-4f65-895d-83ab8e76aada)
However we can override this by disabling typescript check for next line
![image](https://github.com/vitest-dev/vitest/assets/67923777/aa31b340-a400-47d4-8987-cd94a37ed36a)
... and this works pretty good because istanbul is using `require()` to handle this scenario https://github.com/istanbuljs/istanbuljs/blob/master/packages/istanbul-reports/index.js#L19

Problem 2: No possibility to replace coverage page in `@vitest/ui` 
![image](https://github.com/vitest-dev/vitest/assets/67923777/3dc30029-0c6c-497a-af7c-f695ee6ebb41)
I would like to use report generated from custom reporter under `@vitest/ui` coverage page, but seems like currently it's not possible to do.

### Suggested solution

1. Replace
```ts
type CoverageReporter = keyof ReportOptions;
// with
type CoverageReporter = keyof ReportOptions | string;
```
2. Add necessary logic with following option in vitest config:
```diff
export default defineConfig({
+ ui: {
+  enabled: true,
+  coverageReportProvider: 'custom-coverage-reporter' // default "html"
+ },
});
```

### Alternative

_No response_

### Additional context

_No response_

### Validations

- [X] Follow our [Code of Conduct](https://github.com/vitest-dev/vitest/blob/main/CODE_OF_CONDUCT.md)
- [X] Read the [Contributing Guidelines](https://github.com/vitest-dev/vitest/blob/main/CONTRIBUTING.md).
- [X] Read the [docs](https://vitest.dev/guide/).
- [X] Check that there isn't already an issue that request the same feature to avoid creating a duplicate.

---

2023-09-19T14:10:37Z

I think this would be great feature. I'm not yet sure what would be the best way to handle the `@vitest/ui` part though.  Currently it's simply checking whether `reporters` includes `html` reporter. 

---

2023-10-08T00:42:11Z

I created a draft PR: https://github.com/vitest-dev/vitest/pull/4270 could someone take a look and see if this is the right direction?
Custom coverage reporter I'm planning to use: https://github.com/akcyp/coverage-pretty-html-reporter (heavily inspired by the code and look of vitest/ui 😄)

---

2024-01-01T16:23:41Z

I have successfully implemented a custom coverage report with Vitest [Custom Coverage Provider](https://vitest.dev/guide/coverage.html#custom-coverage-provider), see repo: [Vitest Monocart Coverage](https://github.com/cenfun/vitest-monocart-coverage)
What's the difference between `Custom Coverage Provider` and [custom reporter support](https://github.com/vitest-dev/vitest/pull/4828)?


---

2024-01-01T16:43:58Z

> What's the difference between `Custom Coverage Provider` and custom reporter support?

Coverage providers are modules that integrate into Vitest's runtime and setup coverage support. They take care of instrumentation, coverage collection, source maps, etc. Check built-in providers [`@vitest/coverage-v8`](https://github.com/vitest-dev/vitest/tree/main/packages/coverage-v8) and [`@vitest/coverage-istanbul`](https://github.com/vitest-dev/vitest/tree/main/packages/coverage-istanbul) for reference. 

Coverage reporters are Istanbul compatible reporters. They take istanbul's coverage map and convert that into HTML, JSON, LCOV, Teamcity or any other formats. See built-in reporters from Istanbul for reference: https://github.com/istanbuljs/istanbuljs/tree/master/packages/istanbul-reports/lib.

---

2024-01-02T03:48:08Z

Thanks for the answer  @AriPerkkio 
Is it possible to support the native V8 coverage report? It can show the Bytes coverage directly, see [here](https://cenfun.github.io/monocart-coverage-reports/v8/)
for example:
```js
export default defineConfig({
    test: {
        coverage: {
            enabled: true,
            provider: "v8",
            reporter: [
                ["v8-html", { outputDir: "./coverage-reports"} ]
            ]
        }
    }
});
```
When provider is V8, the `v8-html` could generate native V8 coverage report without converting to Istanbul.
Basically here is the idea:
```js
// v8-html.js
export default class {
    constructor(options) {
        this.options = options.
        this.coverageList = [];
    }
    onClean() {
      // remove previous report in `this.options.outputDir`
    }
    onCoverageDataCollected(coverageData) {
      // add coverage data
      this.coverageList.push(coverageData);
    }
    onTestEnd() {
      // generate reports with all collected coverage data and save to `this.options.outputDir`
      // return a html link to Vitest UI report 
      return reportHtmlPath;
    }
}
```
If it is implemented, I can easily integrate native V8 Reports with [monocart-coverage-reports](https://github.com/cenfun/monocart-coverage-reports)
Thanks



---

2024-01-02T14:40:00Z

> Is it possible to support the native V8 coverage report?

The `@vitest/coverage-v8` provider does not expose the raw V8 [`Profiler.ScriptCoverage`](https://chromedevtools.github.io/devtools-protocol/v8/Profiler/#type-ScriptCoverage) reports. As far as I know there are no published NPM packages that could remap `ScriptCoverage` to original sources. Vitest, Jest, Playwright and C8 are all converting the results with `v8-to-istanbul`. Then we can use `istanbul-lib-source-maps` to remap the coverage using source maps from Vite. Without remapping the coverage would only work for non-transpiled Javascript source files. Anything more complex will show invalid coverage. Due to this reason I don't think we will ever expose raw V8 reports. 

With custom coverage provider you can do basically anything. You can collect the V8 coverage and process the raw files yourself as you see fit. Though you'll need to look into how to remap results with `source-map` or `@jridgewell/trace-mapping` packages. 

---

2024-01-15T09:30:38Z

What about using custom coverage reporter under @vitest/ui coverage page?

---

2024-01-15T09:49:07Z

That's not yet supported but there's open PR for it: https://github.com/vitest-dev/vitest/pull/4270


