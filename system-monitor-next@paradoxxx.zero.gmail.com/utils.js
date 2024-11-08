function sm_log(message, level = 'log') {
    const prefix = '[system-monitor-next]';
    switch (level) {
        case 'error':
            console.error(`${prefix} ${message}`);
            break;
        case 'warn':
            console.warn(`${prefix} ${message}`);
            break;
        default:
            console.log(`${prefix} ${message}`);
    }
}

export { sm_log };
