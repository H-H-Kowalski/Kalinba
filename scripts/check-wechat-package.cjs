#!/usr/bin/env node
// Conservative size check: count every file, including DevTools configuration.
// This checks a local build; it does not upload or substitute for DevTools' report.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || 'build/wechatgame');
const limit = 4 * 1024 * 1024;
const files = [];
function walk(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile()) files.push({path: path.relative(root, file), bytes: fs.statSync(file).size});
        else throw new Error(`Unsupported package entry: ${file}`);
    }
}
walk(root);
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const game = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));
if (game.subpackages?.length || game.subPackages?.length) {
    throw new Error('Subpackages detected; this script currently checks a single main package only.');
}
const projectConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../project.config.json'), 'utf8'));
const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
const report = {
    buildPath: root, measurement: 'all local files, uncompressed, no exclusions',
    fileCount: files.length, appid: config.appid, totalBytes, limitBytes: limit,
    remainingBytes: limit - totalBytes, mib: Number((totalBytes / 1024 / 1024).toFixed(3)),
    files: files.sort((a, b) => b.bytes - a.bytes),
};
console.log(JSON.stringify(report, null, 2));
if (totalBytes > limit) {
    console.error(`Main package exceeds 4 MiB by ${totalBytes - limit} bytes.`);
    process.exitCode = 1;
}
if (!config.appid || config.appid === 'wx6ac3f5090a6b99c5' || config.appid !== projectConfig.appid) {
    console.error('Built AppID does not match the registered project AppID.');
    process.exitCode = 1;
}
