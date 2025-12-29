import * as vscode from 'vscode';
import { CanvasMcpClient } from './mcpClient';

let mcpClient: CanvasMcpClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Canvas Author extension is now active');

    // Initialize MCP client
    mcpClient = new CanvasMcpClient();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('canvas-author.init', initCourse),
        vscode.commands.registerCommand('canvas-author.pull', pullPages),
        vscode.commands.registerCommand('canvas-author.push', pushPages),
        vscode.commands.registerCommand('canvas-author.status', showStatus),
        vscode.commands.registerCommand('canvas-author.listCourses', listCourses)
    );

    // Show status bar item when in a Canvas course directory
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBarItem.text = '$(cloud) Canvas';
    statusBarItem.tooltip = 'Canvas Author - Click to sync';
    statusBarItem.command = 'canvas-author.status';

    // Show status bar if .canvas.json exists
    if (vscode.workspace.workspaceFolders) {
        const canvasConfig = await vscode.workspace.findFiles('.canvas.json', null, 1);
        if (canvasConfig.length > 0) {
            statusBarItem.show();
        }
    }

    context.subscriptions.push(statusBarItem);
}

async function initCourse() {
    // Get list of courses first
    const courses = await listCoursesQuiet();
    if (!courses || courses.length === 0) {
        vscode.window.showErrorMessage('No courses found. Check your Canvas credentials.');
        return;
    }

    // Let user pick a course
    const items = courses.map(c => ({
        label: c.name,
        description: c.course_code,
        detail: `ID: ${c.id}`,
        courseId: c.id
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a course to initialize'
    });

    if (!selected) {
        return;
    }

    // Get target directory
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    try {
        await mcpClient?.callTool('init_course', {
            course_id: selected.courseId,
            directory: folders[0].uri.fsPath
        });
        vscode.window.showInformationMessage(`Initialized course: ${selected.label}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to initialize: ${error}`);
    }
}

async function pullPages() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Pulling pages from Canvas...',
            cancellable: false
        }, async () => {
            const result = await mcpClient?.callTool('pull_pages', {
                directory: folders[0].uri.fsPath
            });
            return result;
        });
        vscode.window.showInformationMessage('Pages pulled successfully');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to pull pages: ${error}`);
    }
}

async function pushPages() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Pushing pages to Canvas...',
            cancellable: false
        }, async () => {
            const result = await mcpClient?.callTool('push_pages', {
                directory: folders[0].uri.fsPath
            });
            return result;
        });
        vscode.window.showInformationMessage('Pages pushed successfully');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to push pages: ${error}`);
    }
}

async function showStatus() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    try {
        const result = await mcpClient?.callTool('sync_status', {
            directory: folders[0].uri.fsPath
        });

        // Show status in output channel
        const channel = vscode.window.createOutputChannel('Canvas Author');
        channel.clear();
        channel.appendLine('Canvas Sync Status');
        channel.appendLine('==================');
        channel.appendLine(JSON.stringify(result, null, 2));
        channel.show();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to get status: ${error}`);
    }
}

async function listCourses() {
    try {
        const courses = await listCoursesQuiet();
        if (!courses || courses.length === 0) {
            vscode.window.showInformationMessage('No courses found');
            return;
        }

        const channel = vscode.window.createOutputChannel('Canvas Author');
        channel.clear();
        channel.appendLine('Available Courses');
        channel.appendLine('=================');
        for (const course of courses) {
            channel.appendLine(`${course.id}: ${course.name} (${course.course_code})`);
        }
        channel.show();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to list courses: ${error}`);
    }
}

async function listCoursesQuiet(): Promise<Array<{id: string, name: string, course_code: string}> | undefined> {
    try {
        const result = await mcpClient?.callTool('list_courses', {});
        return result?.courses;
    } catch (error) {
        console.error('Failed to list courses:', error);
        return undefined;
    }
}

export function deactivate() {
    mcpClient?.dispose();
}
