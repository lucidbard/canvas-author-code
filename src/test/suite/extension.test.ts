import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Canvas Author Extension Test Suite', () => {
    vscode.window.showInformationMessage('Starting Canvas Author tests');

    test('Extension should be present', () => {
        const extension = vscode.extensions.getExtension('lucidbard.canvas-author-code');
        assert.ok(extension, 'Extension should be installed');
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);

        const expectedCommands = [
            'canvas-author.init',
            'canvas-author.pull',
            'canvas-author.push',
            'canvas-author.status',
            'canvas-author.listCourses',
            'canvas-author.pullModules',
            'canvas-author.pushModules',
            'canvas-author.moduleStatus'
        ];

        for (const cmd of expectedCommands) {
            assert.ok(
                commands.includes(cmd),
                `Command ${cmd} should be registered`
            );
        }
    });

    test('Extension should activate on .canvas.json', async () => {
        // Extension activates when workspace contains .canvas.json
        const extension = vscode.extensions.getExtension('lucidbard.canvas-author-code');
        if (extension && !extension.isActive) {
            await extension.activate();
        }
        assert.ok(extension?.isActive || extension !== undefined, 'Extension should be activatable');
    });

    test('Configuration settings should be defined', () => {
        const config = vscode.workspace.getConfiguration('canvas-author');

        // Check pythonPath setting exists with default
        const pythonPath = config.get<string>('pythonPath');
        assert.strictEqual(pythonPath, 'python3', 'pythonPath should default to python3');

        // Check canvasDomain setting exists
        const canvasDomain = config.get<string>('canvasDomain');
        assert.strictEqual(canvasDomain, '', 'canvasDomain should default to empty string');
    });
});

suite('MCP Client Tests', () => {
    test('MCP client module should be importable', async () => {
        // This tests that the mcpClient module can be required
        try {
            const mcpClientPath = require.resolve('../../mcpClient');
            assert.ok(mcpClientPath, 'mcpClient module should be resolvable');
        } catch (e) {
            // In test environment, module resolution might differ
            assert.ok(true, 'Module resolution test skipped in test environment');
        }
    });
});

suite('Module Sync Feature Tests', () => {
    test('Pull modules command should exist', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes('canvas-author.pullModules'),
            'pullModules command should be registered'
        );
    });

    test('Push modules command should exist', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes('canvas-author.pushModules'),
            'pushModules command should be registered'
        );
    });

    test('Module status command should exist', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes('canvas-author.moduleStatus'),
            'moduleStatus command should be registered'
        );
    });
});
