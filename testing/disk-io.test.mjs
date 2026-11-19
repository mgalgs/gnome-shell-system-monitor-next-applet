// Run with: node --experimental-vm-modules --test testing/disk-io.test.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

async function monitor(device) {
    let now = 1_000_000;
    let contents = '';
    const context = vm.createContext({TextDecoder});
    class ElementBase {
        constructor(extension, config) {
            this.extension = extension;
            this.config = config;
            this.device_id = config.device;
            this.label = {};
        }
    }
    const dependencies = {
        'resource:///org/gnome/shell/extensions/extension.js': {gettext: text => text},
        'gi://GLib': {default: {get_monotonic_time: () => now}},
        'gi://Gio': {default: {
            file_new_for_path: () => ({
                load_contents_async: (_cancel, callback) => callback({
                    load_contents_finish: () => [true, contents],
                }, null),
            }),
        }},
        '../common.js': {parse_bytearray: value => value},
        '../base.js': {ElementBase},
    };
    const source = await readFile(new URL('../system-monitor-next@paradoxxx.zero.gmail.com/widgets/disk.js', import.meta.url), 'utf8');
    const module = new vm.SourceTextModule(source, {context});
    await module.link(specifier => {
        const exports = dependencies[specifier];
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [name, value] of Object.entries(exports))
                this.setExport(name, value);
        }, {context});
    });
    await module.evaluate();
    const disk = new module.namespace.Disk({
        _MountsMonitor: {get_mounts: () => [], add_listener() {}},
        _Locale: 'en',
        _Style: {diskunits: () => 'MiB/s'},
    }, {device});
    return (rows, seconds = 1) => {
        now += seconds * 1_000_000;
        contents = rows.map(([name, read, write]) =>
            `8 0 ${name} 0 0 ${read} 0 0 0 ${write} 0 0 0 0`).join('\n') + '\n';
        let reading;
        disk.collectAsync(result => { reading = result; });
        return reading;
    };
}

test('first reading establishes a baseline; 2048 sectors per second is 1 MiB/s', async () => {
    const sample = await monitor('/dev/sda');
    assert.equal(sample([['sda', 100000, 200000]]).metrics.read, 0);
    const result = sample([['sda', 102048, 204096]]);
    assert.equal(result.metrics.read, 1);
    assert.equal(result.metrics.write, 2);
    assert.equal(result.display, '1');
    assert.equal(result.unit, 'MiB/s');
});

test('selecting sda1 does not also count its parent sda', async () => {
    const sample = await monitor('/dev/sda1');
    sample([['sda', 100, 100], ['sda1', 100, 100]]);
    const result = sample([['sda', 4196, 4196], ['sda1', 2148, 2148]]);
    assert.equal(result.metrics.read, 1);
    assert.equal(result.metrics.write, 1);
});

test('zero elapsed time preserves the baseline and counter resets never go negative', async () => {
    const sample = await monitor('/dev/nvme0n1');
    sample([['nvme0n1', 10000, 10000]]);
    assert.equal(sample([['nvme0n1', 12048, 12048]], 0).metrics.read, 0);
    assert.equal(sample([['nvme0n1', 14096, 14096]]).metrics.read, 2);
    assert.equal(sample([['nvme0n1', 0, 0]]).metrics.read, 0);
    assert.equal(sample([['nvme0n1', 2048, 2048]]).metrics.read, 1);
});
