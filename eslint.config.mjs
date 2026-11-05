import babelParser from '@babel/eslint-parser';

// Correctness rules apply to production code, tests and build/browser runners.
// TypeScript owns type/null checking; ESLint owns hazardous control flow and
// JavaScript semantics. Generated Android/web bundles are not source inputs.
const rules={
      'constructor-super':'error',
      'for-direction':'error',
      'getter-return':'error',
      'no-async-promise-executor':'error',
      'no-compare-neg-zero':'error',
      'no-cond-assign':['error','always'],
      'no-constant-binary-expression':'error',
      'no-control-regex':'error',
      'no-debugger':'error',
      'no-dupe-args':'error',
      'no-dupe-else-if':'error',
      'no-dupe-keys':'error',
      'no-duplicate-case':'error',
      'no-empty-character-class':'error',
      'no-ex-assign':'error',
      'no-fallthrough':'error',
      'no-func-assign':'error',
      'no-import-assign':'error',
      'no-irregular-whitespace':'error',
      'no-loss-of-precision':'error',
      'no-misleading-character-class':'error',
      'no-new-native-nonconstructor':'error',
      'no-obj-calls':'error',
      'no-promise-executor-return':'error',
      'no-regex-spaces':'error',
      'no-self-assign':'error',
      'no-setter-return':'error',
      'no-sparse-arrays':'error',
      'no-this-before-super':'error',
      'no-unexpected-multiline':'error',
      'no-unreachable':'error',
      'no-unreachable-loop':'error',
      'no-unsafe-finally':'error',
      'no-unsafe-negation':'error',
      'no-unsafe-optional-chaining':'error',
      'no-useless-backreference':'error',
      'no-with':'error',
      'require-yield':'error',
      'use-isnan':'error',
      'valid-typeof':'error',
    };

export default [
  { ignores: ['node_modules/**','dist/**','android/**','docs/**','public/assets/**'] },
  { files:['scripts/**/*.{mjs,js}','public/audio/*.js','*.mjs'],languageOptions:{ecmaVersion:'latest',sourceType:'module'},rules },
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts', '*.ts'],
    languageOptions: {
      parser: babelParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {babelrc:false,configFile:false,parserOpts:{plugins:['typescript','jsx']}},
      },
    },
    rules,
  },
];
