let dummyTabId: number | null = null;
let originalTabId: number | null = null;
let originalWindowId: number | null = null;

let isFirefoxFocused = true;
let timeoutId: ReturnType<typeof setTimeout> | null = null;

let activeWindowId: number | null = null;
let activeTabId: number | null = null;

browser.windows.getCurrent().then(async (win) => {
	if (win && win.id !== undefined) {
		activeWindowId = win.id;
		try {
			const tabs = await browser.tabs.query({ active: true, windowId: win.id });
			if (tabs.length > 0) activeTabId = tabs[0].id ?? null;
		} catch {}
	}
});

browser.tabs.onActivated.addListener((activeInfo) => {
	if (activeInfo.tabId === dummyTabId) return;

	activeWindowId = activeInfo.windowId;
	activeTabId = activeInfo.tabId;
});

async function handleFocusLoss() {
	if (dummyTabId !== null) return;
	if (!activeWindowId || !activeTabId) return;

	try {
		const tab = await browser.tabs.get(activeTabId);
		if (!tab || !tab.audible) return;

		if (isFirefoxFocused) return;

		originalTabId = activeTabId;
		originalWindowId = activeWindowId;

		const dummyTab = await browser.tabs.create({
			windowId: originalWindowId,
			url: 'about:blank',
			active: false,
		});

		if (isFirefoxFocused) {
			if (dummyTab.id !== undefined) {
				try {
					await browser.tabs.remove(dummyTab.id);
				} catch {}
			}
			return;
		}

		dummyTabId = dummyTab.id ?? null;

		timeoutId = setTimeout(async () => {
			if (dummyTabId && !isFirefoxFocused) {
				try {
					await browser.tabs.update(dummyTabId, { active: true });
				} catch {}
			}
		}, 50);
	} catch {}
}

async function handleFocusGain(focusedWindowId: number) {
	if (timeoutId) {
		clearTimeout(timeoutId);
		timeoutId = null;
	}

	if (!dummyTabId || !originalTabId || !originalWindowId) {
		activeWindowId = focusedWindowId;
		try {
			const tabs = await browser.tabs.query({ active: true, windowId: focusedWindowId });
			if (tabs.length > 0) activeTabId = tabs[0].id ?? null;
		} catch {}
		return;
	}

	const dTabId = dummyTabId;
	const oTabId = originalTabId;
	const oWinId = originalWindowId;

	dummyTabId = null;
	originalTabId = null;
	originalWindowId = null;

	try {
		await browser.tabs.update(oTabId, { active: true });
		await browser.tabs.remove(dTabId);
	} catch {
		// Original tab or dummy tab might have been closed
	}

	if (focusedWindowId !== oWinId) {
		try {
			// Force focus back to the original window
			await browser.windows.update(oWinId, { focused: true });
		} catch {}
	} else {
		activeWindowId = focusedWindowId;
		activeTabId = oTabId;
	}
}

browser.windows.onFocusChanged.addListener(async (windowId) => {
	const hasFocus = windowId !== browser.windows.WINDOW_ID_NONE;
	isFirefoxFocused = hasFocus;

	if (hasFocus) {
		await handleFocusGain(windowId);
	} else {
		await handleFocusLoss();
	}
});

browser.tabs.onRemoved.addListener((tabId) => {
	if (tabId === dummyTabId) {
		dummyTabId = null;
		originalTabId = null;
		originalWindowId = null;
	}
});
