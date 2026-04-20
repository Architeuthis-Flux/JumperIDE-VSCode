/**
 * MicroPython raw-REPL protocol — ported from JumperIDE/src/rawmode.js.
 * Identical wire protocol: Ctrl-A enter, Ctrl-B exit, Ctrl-C interrupt,
 * Ctrl-D execute, OK\x04result\x04error.
 */

import { Transport } from './transport';
import { report } from '../utils';

let replPrompts: string[] = [];

export interface DeviceInfo {
    machine: string;
    release: string;
    sysname: string;
    version: string;
    mpy_arch: string | null;
    mpy_ver: number | string;
    mpy_sub: number;
    sys_path: string[];
}

export interface FsEntry {
    name: string;
    path: string;
    size?: number;
    content?: FsEntry[];
}

export class MpRawMode {
    private endFn: (() => Promise<void>) | null = null;

    constructor(public port: Transport) {}

    static async begin(port: Transport, softReboot = false): Promise<MpRawMode> {
        const res = new MpRawMode(port);
        await res.detectPrompt();
        await res.enterRawRepl(softReboot);
        try {
            await res.exec('import sys,os');
        } catch (err) {
            await res.end();
            throw err;
        }
        return res;
    }

    async detectPrompt(): Promise<void> {
        const release = await this.port.startTransaction();
        replPrompts = ['>>> ', '--> '];
        try {
            await this.port.write('\r\x01');
            await this.port.readUntil('raw REPL; CTRL-B to exit\r\n');
            const userPrompt = `${(await this.exec('import sys; print(sys.ps1)')).trim()} `;
            if (!replPrompts.includes(userPrompt)) {
                replPrompts.push(userPrompt);
            }
            await this.port.write('\x02');
            await this.port.readUntil('>\r\n');
            const activePrompt = await this.port.readUntil(replPrompts);
            if (activePrompt === '--> ') {
                await this.port.write(activePrompt);
            }
        } finally {
            release();
        }
    }

    async interruptProgram(timeout = 20000): Promise<void> {
        const endTime = Date.now() + timeout;
        while (timeout <= 0 || Date.now() < endTime) {
            await this.port.write('\x03');
            try {
                const banner = await this.port.readUntil(replPrompts, 500);
                const promptRegex = new RegExp(`\r\n(?:${replPrompts.join('|')})`);
                if (this.port.prevRecvCbk && !promptRegex.test(banner)) {
                    this.port.prevRecvCbk(banner);
                }
                await this.port.flushInput();
                return;
            } catch (err) {
                report('Interrupt', err);
            }
        }
        throw new Error('Board is not responding');
    }

    async enterRawRepl(softReboot = false): Promise<void> {
        const release = await this.port.startTransaction();
        try {
            await this.interruptProgram();
            await this.port.write('\r\x01');
            await this.port.readUntil('raw REPL; CTRL-B to exit\r\n');
            if (softReboot) {
                await this.port.write('\x04\x03');
                await this.port.readUntil('raw REPL; CTRL-B to exit\r\n');
            }
            this.endFn = async () => {
                try {
                    await this.port.write('\x02');
                    await this.port.readUntil('>\r\n');
                    await this.port.readUntil(replPrompts);
                } finally {
                    release();
                }
            };
        } catch (err) {
            release();
            throw err;
        }
    }

    async end(): Promise<void> {
        if (this.endFn) {
            await this.endFn();
            this.endFn = null;
        }
    }

    async exec(cmd: string, timeout = 5000, emit = false): Promise<string> {
        await this.port.readUntil('>');
        await this.port.write(cmd);
        await this.port.write('\x04');
        const status = await this.port.readExactly(2, timeout);
        if (status !== 'OK') { throw new Error(status); }
        this.port.emit = emit;
        if (emit && this.port.prevRecvCbk) {
            this.port.prevRecvCbk(this.port.receivedData);
        }
        const res = (await this.port.readUntil('\x04', timeout)).slice(0, -1);
        const err = (await this.port.readUntil('\x04', timeout)).slice(0, -1);
        this.port.emit = false;
        if (err.length) { throw new Error(err); }
        return res;
    }

    async readFile(fn: string): Promise<Uint8Array> {
        const rsp = await this.exec(`
try:
 import binascii
 h=lambda x: binascii.hexlify(x).decode()
 h(b'')
except:
 h=lambda b: ''.join('{:02x}'.format(byte) for byte in b)
with open('${fn}','rb') as f:
 while 1:
  b=f.read(64)
  if not b:break
  print(h(b),end='')
`);
        if (rsp.length) {
            return new Uint8Array(rsp.match(/../g)!.map(h => parseInt(h, 16)));
        }
        return new Uint8Array();
    }

    async writeFile(fn: string, data: Uint8Array | string, chunkSize = 128): Promise<void> {
        let bytes: Uint8Array;
        if (typeof data === 'string') {
            bytes = new Uint8Array(Buffer.from(data, 'utf-8'));
        } else {
            bytes = data;
        }

        function hexlify(d: Uint8Array): string {
            return [...d].map(x => x.toString(16).padStart(2, '0')).join('');
        }

        const dest = '.viper.tmp';
        await this.exec(`
try:
 import binascii
 h=binascii.unhexlify
 h('')
except:
 h=lambda s: bytes(int(s[i:i+2], 16) for i in range(0, len(s), 2))
f=open('${dest}','wb')
w=lambda d: f.write(h(d))
o=f.write
`);
        for (let i = 0; i < bytes.byteLength; i += chunkSize) {
            const chunk = bytes.slice(i, i + chunkSize);
            const cmdHex = "w('" + hexlify(chunk) + "')";
            await this.exec(cmdHex);
        }
        await this.exec(`f.close()
try: os.remove('${fn}')
except: pass
os.rename('${dest}','${fn}')
`);
    }

    async getDeviceInfo(): Promise<DeviceInfo> {
        const rsp = await this.exec(`
try: u=os.uname()
except: u=('','','','',sys.platform)
try: v=sys.version.split(';')[1].strip()
except: v='MicroPython '+u[2]
mpy=getattr(sys.implementation, '_mpy', 0)
sp=':'.join(sys.path)
d=[u[4],u[2],u[0],v,mpy>>10,mpy&0xFF,(mpy>>8)&3,sp]
print('|'.join(str(x) for x in d))
`);
        const parts = rsp.trim().split('|');
        const archTable = [null, 'x86', 'x64', 'armv6', 'armv6m', 'armv7m', 'armv7em',
            'armv7emsp', 'armv7emdp', 'xtensa', 'xtensawin', 'rv32imc'];
        let mpy_arch: string | null = null;
        const archIdx = parseInt(parts[4], 10);
        if (archIdx >= 0 && archIdx < archTable.length) { mpy_arch = archTable[archIdx]; }
        let mpy_ver: number | string = parseInt(parts[5], 10);
        if (!mpy_ver) { mpy_ver = 'py'; }

        return {
            machine: parts[0],
            release: parts[1],
            sysname: parts[2],
            version: parts[3],
            mpy_arch,
            mpy_ver,
            mpy_sub: parseInt(parts[6], 10),
            sys_path: (parts[7] || '').split(':'),
        };
    }

    async walkFs(): Promise<FsEntry[]> {
        const rsp = await this.exec(`
def walk(p):
 for n in os.listdir(p if p else '/'):
  fn=p+'/'+n
  try: s=os.stat(fn)
  except: s=(0,)*7
  try:
   if s[0] & 0x4000 == 0:
    print('f|'+fn+'|'+str(s[6]))
   elif n not in ('.','..'):
    print('d|'+fn+'|'+str(s[6]))
    walk(fn)
  except:
   print('f|'+p+'/???|'+str(s[6]))
walk('')
`);
        const result: FsEntry[] = [];
        for (const line of rsp.split('\n')) {
            if (!line.trim()) { continue; }
            const [type, fullpath, sizeStr] = line.trim().split('|');
            const pathParts = fullpath.split('/');
            let file: string | undefined;
            if (type === 'f') { file = pathParts.pop(); }
            let current = result;
            for (const seg of pathParts) {
                if (!seg) { continue; }
                const existing = current.find(x => x.name === seg && x.content);
                if (existing) {
                    current = existing.content!;
                } else {
                    const children: FsEntry[] = [];
                    current.push({ name: seg, path: pathParts.join('/'), content: children });
                    current = children;
                }
            }
            if (type === 'f' && file) {
                current.push({ name: file, path: fullpath, size: parseInt(sizeStr, 10) });
            }
        }
        return result;
    }

    async getFsStats(path = '/'): Promise<[string, string, string]> {
        const rsp = await this.exec(`
s = os.statvfs('${path}')
fs = s[1] * s[2]
ff = s[3] * s[0]
fu = fs - ff
print('%s|%s|%s'%(fu,ff,fs))
`);
        return rsp.trim().split('|') as [string, string, string];
    }

    async touchFile(fn: string): Promise<void> {
        await this.exec(`f=open('${fn}','wb')\nf.close()`);
    }

    async makePath(path: string): Promise<void> {
        await this.exec(`
p=''
for d in '${path}'.split('/'):
 if not d: continue
 p += '/'+d
 try: os.mkdir(p)
 except OSError as e:
  if e.args[0] not in (17, 20): raise
`);
    }

    async removeFile(path: string): Promise<void> {
        await this.exec(`os.remove('${path}')`);
    }

    async removeDir(path: string): Promise<void> {
        await this.exec(`os.rmdir('${path}')`);
    }

    async pushFramebuffer(base64Data: string): Promise<void> {
        await this.exec(`import binascii;oled_set_framebuffer(binascii.a2b_base64('${base64Data}'));oled_show()`);
    }
}

export function getReplPrompts(): string[] {
    return replPrompts;
}
