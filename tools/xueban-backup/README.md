# Xueban Full Backup Tool

This local administrator tool exports the current CloudBase business database,
downloads registered cloud-storage prefixes, preserves every model snapshot,
builds cross-layer integrity reports, and produces a GPG-encrypted archive.

It uses the signed-in WeChat DevTools read APIs. It does not deploy or call
business cloud functions and does not add, update, or delete cloud records.

## Commands

```bash
node src/cli.js inventory \
  --project /Users/wangwei/Documents/xueban

node src/cli.js backup \
  --project /Users/wangwei/Documents/xueban \
  --output /absolute/path/to/local-backups \
  --key-file /absolute/path/to/backup.passphrase \
  --create-key \
  --allow-project-output

node src/cli.js verify \
  --archive /absolute/path/to/backup.tar.gz.gpg \
  --key-file /absolute/path/to/backup.passphrase
```

`--allow-project-output` is required if the output is inside the Git worktree.
The repository ignores `/local-backups/`, but the encryption key should still
be copied to a separate offline location after the first successful backup.

## Safety

- Full backup exports all actual collections, including unknown collections.
- The storage inventory is independent of `voice_records`, so orphaned audio is
  retained and reported.
- All draft, active, historical, Teacher, Student, TEST, and non-TEST snapshots
  are exported from `model_snapshots`.
- A backup is marked restorable only if there are no fatal integrity errors and
  the source inventory did not change during the run.
- The tool contains no restore or cloud-delete command.
