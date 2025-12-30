import * as vscode from 'vscode';
import { CanvasMcpClient } from './mcpClient';

// Response type interfaces
interface Course {
    id: string;
    name: string;
    course_code: string;
}

interface ListCoursesResponse {
    courses: Course[];
}

interface PullModulesResponse {
    modules_count: number;
    items_count: number;
    file: string;
}

interface PushModulesResponse {
    created: Array<{ name: string; id: string }>;
    updated: Array<{ name: string; id: string }>;
    deleted: Array<{ name: string; id: string }>;
    errors: Array<{ name?: string; error: string }>;
}

interface ModuleStatusResponse {
    synced: Array<{ name: string }>;
    canvas_only: Array<{ name: string }>;
    local_only: Array<{ name: string }>;
    summary: {
        synced_count: number;
        canvas_only_count: number;
        local_only_count: number;
    };
}

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
        vscode.commands.registerCommand('canvas-author.listCourses', listCourses),
        vscode.commands.registerCommand('canvas-author.pullModules', pullModules),
        vscode.commands.registerCommand('canvas-author.pushModules', pushModules),
        vscode.commands.registerCommand('canvas-author.moduleStatus', showModuleStatus)
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

async function listCoursesQuiet(): Promise<Course[] | undefined> {
    try {
        const result = await mcpClient?.callTool<ListCoursesResponse>('list_courses', {});
        return result?.courses;
    } catch (error) {
        console.error('Failed to list courses:', error);
        return undefined;
    }
}

async function pullModules() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    try {
        const result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Pulling modules from Canvas...',
            cancellable: false
        }, async () => {
            return await mcpClient?.callTool<PullModulesResponse>('pull_modules', {
                directory: folders[0].uri.fsPath
            });
        });

        const moduleCount = result?.modules_count ?? 0;
        const itemCount = result?.items_count ?? 0;
        vscode.window.showInformationMessage(
            `Pulled ${moduleCount} modules with ${itemCount} items to modules.yaml`
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to pull modules: ${error}`);
    }
}

async function pushModules() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    // Ask about delete behavior
    const deleteChoice = await vscode.window.showQuickPick([
        { label: 'Keep', description: 'Keep modules in Canvas that are not in local file', value: false },
        { label: 'Delete', description: 'Delete modules in Canvas that are not in local file', value: true }
    ], {
        placeHolder: 'What to do with modules in Canvas not in modules.yaml?'
    });

    if (!deleteChoice) {
        return;
    }

    try {
        const result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Pushing modules to Canvas...',
            cancellable: false
        }, async () => {
            return await mcpClient?.callTool<PushModulesResponse>('push_modules', {
                directory: folders[0].uri.fsPath,
                delete_missing: deleteChoice.value
            });
        });

        const created = result?.created?.length ?? 0;
        const updated = result?.updated?.length ?? 0;
        const deleted = result?.deleted?.length ?? 0;
        const errors = result?.errors?.length ?? 0;

        let message = `Modules: ${created} created, ${updated} updated`;
        if (deleted > 0) {
            message += `, ${deleted} deleted`;
        }
        if (errors > 0) {
            message += ` (${errors} errors)`;
            vscode.window.showWarningMessage(message);
        } else {
            vscode.window.showInformationMessage(message);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to push modules: ${error}`);
    }
}

async function showModuleStatus() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    try {
        const result = await mcpClient?.callTool<ModuleStatusResponse>('module_status', {
            directory: folders[0].uri.fsPath
        });

        const channel = vscode.window.createOutputChannel('Canvas Author');
        channel.clear();
        channel.appendLine('Canvas Module Sync Status');
        channel.appendLine('=========================');
        channel.appendLine('');

        const summary = result?.summary;
        if (summary) {
            channel.appendLine(`Synced: ${summary.synced_count}`);
            channel.appendLine(`Canvas only: ${summary.canvas_only_count}`);
            channel.appendLine(`Local only: ${summary.local_only_count}`);
            channel.appendLine('');
        }

        if (result?.synced && result.synced.length > 0) {
            channel.appendLine('Synced Modules:');
            for (const m of result.synced) {
                channel.appendLine(`  + ${m.name}`);
            }
            channel.appendLine('');
        }

        if (result?.canvas_only && result.canvas_only.length > 0) {
            channel.appendLine('Canvas Only (not in local):');
            for (const m of result.canvas_only) {
                channel.appendLine(`  > ${m.name}`);
            }
            channel.appendLine('');
        }

        if (result?.local_only && result.local_only.length > 0) {
            channel.appendLine('Local Only (not in Canvas):');
            for (const m of result.local_only) {
                channel.appendLine(`  < ${m.name}`);
            }
        }

        channel.show();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to get module status: ${error}`);
    }
}

export function deactivate() {
    mcpClient?.dispose();
}
