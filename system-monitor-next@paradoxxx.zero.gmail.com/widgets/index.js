/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// Widgets Index
// Register all widgets here

import MemoryWidget from './memory-widget.js';

/**
 * Register all widgets with the registry.
 *
 * @param {WidgetRegistry} registry - The widget registry instance
 */
export default function registerAllWidgets(registry) {
    registry.register(MemoryWidget);
    // Additional widgets will be registered here as they are migrated
}
