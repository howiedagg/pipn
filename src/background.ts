let isFirefoxFocused = true;
let timeoutId: ReturnType<typeof setTimeout> | null = null;

// 💡 透過瀏覽器的持久化儲存，避免擴充功能休眠後變數遺失
async function getState() {
	const res = await browser.storage.local.get(['pipnState']);
	return (
		res.pipnState || {
			dummyTabId: null,
			originalTabId: null,
			originalWindowId: null,
			activeWindowId: null,
			activeTabId: null,
		}
	);
}

async function updateState(updates: any) {
	const state = await getState();
	const newState = { ...state, ...updates };
	await browser.storage.local.set({ pipnState: newState });
	return newState;
}

// 初始化追蹤狀態
browser.windows.getCurrent().then(async (win) => {
	if (win && win.id !== undefined) {
		const state = await getState();
		if (!state.activeWindowId) {
			let currentTabId = null;
			try {
				const tabs = await browser.tabs.query({ active: true, windowId: win.id });
				if (tabs.length > 0) currentTabId = tabs[0].id ?? null;
			} catch {}
			await updateState({ activeWindowId: win.id, activeTabId: currentTabId });
		}
	}
});

browser.tabs.onActivated.addListener(async (activeInfo) => {
	const state = await getState();
	if (activeInfo.tabId === state.dummyTabId) return;

	await updateState({
		activeWindowId: activeInfo.windowId,
		activeTabId: activeInfo.tabId,
	});
});

async function handleFocusLoss() {
	const state = await getState();

	if (state.dummyTabId !== null) return;
	if (!state.activeWindowId || !state.activeTabId) return;

	try {
		const tab = await browser.tabs.get(state.activeTabId);
		if (!tab || !tab.audible) return;

		if (isFirefoxFocused) return;

		const dummyTab = await browser.tabs.create({
			windowId: state.activeWindowId,
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

		const newDummyTabId = dummyTab.id ?? null;
		await updateState({
			dummyTabId: newDummyTabId,
			originalTabId: state.activeTabId,
			originalWindowId: state.activeWindowId,
		});

		timeoutId = setTimeout(async () => {
			if (newDummyTabId && !isFirefoxFocused) {
				try {
					await browser.tabs.update(newDummyTabId, { active: true });
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

	const state = await getState();

	if (!state.dummyTabId || !state.originalTabId || !state.originalWindowId) {
		let currentTabId = null;
		try {
			const tabs = await browser.tabs.query({ active: true, windowId: focusedWindowId });
			if (tabs.length > 0) currentTabId = tabs[0].id ?? null;
		} catch {}
		await updateState({
			activeWindowId: focusedWindowId,
			activeTabId: currentTabId,
		});
		return;
	}

	const dTabId = state.dummyTabId;
	const oTabId = state.originalTabId;
	const oWinId = state.originalWindowId;

	// 無論接下來成不成功，先清空追蹤狀態以避免卡死
	await updateState({
		dummyTabId: null,
		originalTabId: null,
		originalWindowId: null,
	});

	// 💡 關鍵修正：將「還原」跟「移除」分開捕捉錯誤
	// 如果還原影片分頁失敗(例如被系統關閉了)，我們依然要保證能刪除空白頁
	try {
		await browser.tabs.update(oTabId, { active: true });
	} catch {
		// Original tab might have been closed or suspended
	}

	try {
		await browser.tabs.remove(dTabId);
	} catch {
		// Dummy tab might have been closed manually
	}

	if (focusedWindowId !== oWinId) {
		try {
			await browser.windows.update(oWinId, { focused: true });
		} catch {}
	} else {
		await updateState({
			activeWindowId: focusedWindowId,
			activeTabId: oTabId,
		});
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

browser.tabs.onRemoved.addListener(async (tabId) => {
	const state = await getState();
	if (tabId === state.dummyTabId) {
		await updateState({
			dummyTabId: null,
			originalTabId: null,
			originalWindowId: null,
		});
	}
});
