chrome.commands.onCommand.addListener(async (command) => {
	if (command !== 'open-agent') return;
	const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
	if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
});