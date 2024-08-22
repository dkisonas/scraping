import puppeteer from 'puppeteer';
import proxyChain from 'proxy-chain';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
const CONFIG = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Sleep function with randomization
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Random interval function to simulate human behavior
const randomInterval = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

// Function to create a proxy URL with authentication
const createProxyUrl = (config) => {
    const { username, password, endpoint } = config;
    return `http://${username}:${password}@${endpoint}`;
};

// Function to initialize Puppeteer browser with a new IP
const initializeBrowserWithNewIP = async (proxyConfig) => {
    const oldProxyUrl = createProxyUrl(proxyConfig);
    const newProxyUrl = await proxyChain.anonymizeProxy(oldProxyUrl);

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            `--proxy-server=${newProxyUrl}`
        ]
    });

    const page = await browser.newPage();
    return { browser, page };
};

// Function to navigate with retry logic
const navigateWithRetry = async (page, url, retries = 3, timeout = 60000) => {
    for (let i = 0; i < retries; i++) {
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout });
            return true; // Successfully navigated
        } catch (error) {
            console.error(`Navigation failed. Attempt ${i + 1} of ${retries}. Error: ${error.message}`);
            if (i < retries - 1) {
                console.log('Retrying after delay...');
                await sleep(randomInterval(5000, 10000)); // Wait before retrying
            } else {
                console.log('Maximum navigation retries exceeded.');
                return false;
            }
        }
    }
};

// Function to handle consents with optional skipping if not found
const handleConsents = async (page, selectors) => {
    try {
        await page.waitForSelector(selectors.consentButton, { timeout: 20000 });
        await page.click(selectors.consentButton, { timeout: 10000 });
    } catch (error) {
        console.log('Consent button not found or not loaded in time, skipping...');
    }

    try {
        await page.waitForSelector(selectors.cookieButton, { timeout: 20000 });
        await page.click(selectors.cookieButton, { timeout: 10000 });
    } catch (error) {
        console.log('Cookie button not found or not loaded in time, skipping...');
    }
    console.log('Consent handling completed or skipped.');
};

// Function to vote with possible alternative candidates and log votes
const voteMultipleTimes = async (page, selectors, times, minDelay, maxDelay, voteLog) => {
    try {
        for (let i = 0; i < times; i++) {
            // Randomly decide whether to vote for the main candidate or an alternative
            const voteForMain = Math.random() > 0.2; // 70% chance to vote for the main candidate
            const buttonId = voteForMain ? selectors.mainVoteButtonId :
                selectors.alternativeVoteButtonIds[Math.floor(Math.random() * selectors.alternativeVoteButtonIds.length)];

            const buttonSelector = `button[data-id="${buttonId}"]`;

            await page.waitForSelector(buttonSelector, { timeout: 20000 });
            const button = await page.$(buttonSelector);
            if (button) {
                await button.evaluate(b => b.scrollIntoView());
                await sleep(1000);
                await button.click();
                console.log(`Button clicked with data-id: ${buttonId}. Vote ${i + 1} of this session.`);

                // Wait for the vote confirmation element
                await sleep(1500);

                // Check if the element has display: block style
                const confirmationVisible = await page.$eval(selectors.voteConfirmation, element => {
                    const displayStyle = window.getComputedStyle(element).display;
                    return displayStyle === 'block';
                });

                if (confirmationVisible) {
                    console.log('Vote counted successfully. Confirmation visible.');
                    // Log the vote only if the confirmation is visible
                    voteLog.votes.push({ buttonId, timestamp: new Date().toISOString() });
                } else {
                    console.log('Confirmation not visible or vote not counted.');
                }

                await sleep(randomInterval(minDelay, maxDelay)); // Simulate human behavior
            } else {
                console.log(`Vote button not found for data-id: ${buttonId}.`);
            }
        }
        return true;
    } catch (error) {
        console.error('Error during voting:', error.message);
        throw error;
    }
};

// Function to save vote logs and statistics to a file
const saveVoteLog = (voteLog) => {
    const logFilePath = path.join(__dirname, `vote_log${new Date().toISOString()}.json`);

    // Generate statistics
    const totalVotes = voteLog.votes.length;
    const voteCounts = voteLog.votes.reduce((acc, vote) => {
        acc[vote.buttonId] = (acc[vote.buttonId] || 0) + 1;
        return acc;
    }, {});

    voteLog.statistics = {
        totalVotes,
        votesByCandidate: voteCounts,
    };

    fs.writeFileSync(logFilePath, JSON.stringify(voteLog, null, 2));
    console.log(`Vote log and statistics saved to ${logFilePath}`);
};

(async () => {
    let totalVotes = 0;
    const delayBetweenSessions = 3600000 / CONFIG.voting.votesPerHour; // Time in ms between sessions
    const voteLog = {
        votes: [],
        statistics: {}
    };

    while (totalVotes < CONFIG.voting.maxVotes) {
        console.log('Starting a new browser session with a new IP...');
        const { browser, page } = await initializeBrowserWithNewIP(CONFIG.proxy);

        const navigationSuccessful = await navigateWithRetry(page, CONFIG.urls.targetPage, 3, 60000);
        if (!navigationSuccessful) {
            console.error('Failed to navigate to the target page after retries.');
            await browser.close();
            continue;
        }

        try {
            await handleConsents(page, CONFIG.selectors);
            await sleep(1000);
            console.log('Waiting for the top 20 list to load...');
            await page.waitForSelector(CONFIG.selectors.top20List, { timeout: 60000 });

            const votesInThisBatch = randomInterval(1, 5);
            console.log('Will vote ' + votesInThisBatch + ' times in this batch.');
            const votingSuccessful = await voteMultipleTimes(
                page,
                CONFIG.selectors,
                votesInThisBatch,
                3000,
                7000,
                voteLog
            );

            if (votingSuccessful) {
                totalVotes += votesInThisBatch;
                console.log(`Batch completed. Total votes after this batch: ${totalVotes}`);
            }
        } catch (error) {
            console.error('Error occurred during voting process:', error.message);
        }

        console.log('Closing the browser...');
        await browser.close();
        console.log('Browser closed.');

        // Delay between sessions to meet the votesPerHour limit
        if (totalVotes < CONFIG.voting.maxVotes) {
            console.log(`Waiting ${delayBetweenSessions / 1000} seconds before the next session...`);
            await sleep(delayBetweenSessions);
        }
    }

    console.log(`Voting completed. Total votes: ${totalVotes}`);

    // Save vote log and statistics
    saveVoteLog(voteLog);
})();