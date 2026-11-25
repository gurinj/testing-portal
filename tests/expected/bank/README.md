# Results of the bank's test files

`node tests/run-bank.js --record` writes one file here per test file in `tests/files/bank/`
(the test files themselves are never committed or zipped). Each file holds the status and,
per check id, the number of places found: no names, accounts, amounts or other values of
the payment files, so these files can be shared to discuss a result.

`node tests/run-bank.js` (and every `node tools/build.js`) validates the files again and
lists what changed since the recording. See `docs/specs/M2.md`, section 6.
