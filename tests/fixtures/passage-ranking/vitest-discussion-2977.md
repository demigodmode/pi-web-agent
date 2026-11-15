# Coverage configuration guidelines

https://github.com/vitest-dev/vitest/discussions/2977
2023-03-08T03:07:48Z

Hi,

There are many conflicting configuration options, e.g. `include` and `exclude`.
Is there any documentation on which options take precedences over others?

Thanks

---

2023-03-08T06:36:14Z

The `coverage.include` and `coverage.exclude` should behave similarly as `test.include` and `test.exclude`. I think these are quite standard across tooling ecosystem. Generic rule could be something like:
- If everything works for you out-of-the-box, do not change any configurations
- If some file is not visible in coverage report add it into the `includes`
- If some file in unintentionally visible in coverage report add it to the `excludes`

Same logic should be applied to `test.includes` and `test.excludes`.

`nyc` has written some kind of guide related to this: https://github.com/istanbuljs/nyc#using-include-and-exclude-arrays


