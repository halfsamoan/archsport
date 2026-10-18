// Keep long match lists reachable without letting the expanded notch leave the monitor.
export function calculateExpandedViewport({monitorHeight, panelHeight = 0, headerHeight,
    contentHeight, chromeHeight = 42, minRootHeight = 160, maxRootHeight = 520}) {
    const availableHeight = Math.max(minRootHeight,
        Math.min(maxRootHeight, monitorHeight - panelHeight - 24));
    const bodyLimit = Math.max(1, availableHeight - headerHeight - chromeHeight);
    const bodyHeight = Math.max(1, Math.min(contentHeight, bodyLimit));
    return {
        bodyHeight,
        rootHeight: Math.min(availableHeight, Math.ceil(headerHeight + bodyHeight + chromeHeight)),
        scrollable: contentHeight > bodyHeight,
    };
}
