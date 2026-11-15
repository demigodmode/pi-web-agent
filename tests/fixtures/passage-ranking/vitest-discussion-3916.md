# Display coverage from a subdir with Vitest UI

https://github.com/vitest-dev/vitest/discussions/3916
2023-08-08T16:28:47Z

Hi Vitest Team!

Is it possible to have Vitest UI display code coverage results from a sub-directory?

To elaborate, I have the following configuration:
```typescript
const config = defineConfig(({ command }) => ({
  test: {
    include: ['src/**/?(*.)unit.test.[jt]s?(x)'],
    environment: 'happy-dom',
    watch: false,
    root: rootDir,
    reporters: process.env.CI ? 'dot' : undefined,
    setupFiles: ['config/vitest/setup.ts'],
    coverage: {
      include: ['src/**/*.[jt]s?(x)'],
      exclude: ['src/**/?(*.).test.[jt]s?(x)', 'src/mocks/**', 'src/utils/spec.tsx', 'src/config.ts'],
      all: true,
      reportsDirectory: 'test-reports',
      reporter: [
        [process.env.CI ? 'cobertura' : 'text'],
        [
          'html',
          {
            subdir: 'coverage',
          },
        ],
      ],
    },
    mockReset: true,
    resolveSnapshotPath: (path: string, extension: string) => `${path}${extension}`,
  },
}))
```

When I run `npx vitest --coverage --ui --watch` it appears as if the coverage is being picked up, but when I select the coverage icon in the top left, the following error appears in the console:

![Screenshot 2023-08-08 at 9 16 15 AM](https://github.com/vitest-dev/vitest/assets/450495/dce2a115-4f82-48ef-92a6-b2373f85af46)

Based on the error message, the `reportsDirectory` option is being respected, but the `subdir` option associated with the html coverage reporter is not. Are there any configuration options that can be provided to Vitest UI to allow for this setup?

Thank you all for your time and the amazing work you are doing. 🙂 

---

2023-08-08T16:45:58Z

Try running `npx vitest --coverage.enabled=true --ui --watch` or adding `coverage.enabled: true` to your configuration, it should work


