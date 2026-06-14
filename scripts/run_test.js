const { spawn } = require('child_process');

const child = spawn('npx', ['ts-node', 'src/index.ts']);

child.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output);
    
    if (output.includes('Enter your choice (1-5):')) {
        child.stdin.write('5\n');
    }
    if (output.includes('Enter your choice (1-2):')) {
        child.stdin.write('2\n');
    }
    if (output.includes('Do you want to continue with Step 2 (Verification)? (y/n):')) {
        child.stdin.write('y\n');
    }
});

child.stderr.on('data', (data) => {
    process.stderr.write(data.toString());
});

child.on('close', (code) => {
    console.log(`Process exited with code ${code}`);
});
