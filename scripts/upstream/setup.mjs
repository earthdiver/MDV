import { spawn } from 'node:child_process';
import { rubyEnvironment, repositoryRoot } from './client.mjs';

const child = spawn(process.env.MDV_RUBY || 'ruby', ['-rbundler', '-rbundler/cli', '-e', 'Bundler::CLI.start(ARGV)', '--', 'install', '--jobs', '4'], {
  cwd: repositoryRoot, env: rubyEnvironment(), stdio: 'inherit', windowsHide: true,
});
child.on('error', error => { console.error(`Ruby 3.3/3.4 and Bundler are required: ${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
