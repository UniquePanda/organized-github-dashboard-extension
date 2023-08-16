import { Octokit } from "@octokit/rest";

const gitHubBaseUrl = 'https://www.github.com/';

let accessToken = null;
/**
 * @type Octokit
 */
let octokit = null;

let isSettingsAreaInjected = false;
let isHtmlInjected = false;
let injectHtmlInterval = null;
let injectHtmlTryCount = 0;

let settingsAreaContainerDiv = null;

let accessTokenInput = null;
let accessTokenInputButton = null;
let accessTokenInputButtonText = null;
let accessTokenErrorParagraph = null;

let settingsAreaDiv = null;

let repoSelectionDebounceTimeout = null;
const availableRepos = [];
const selectedRepos = [];

injectHtml();

if (!isHtmlInjected) {
    injectHtmlInterval = setInterval(injectHtml, 500);
}

/*
################################
### HTML Injection Functions ###
################################
*/

function injectHtml() {
    if (isHtmlInjected) {
        return;
    }

    injectHtmlTryCount++;

    if (injectHtmlTryCount > 10 && injectHtmlInterval) {
        clearTimeout(injectHtmlInterval);
    }

    if (!isSettingsAreaInjected) {
        // The "details" element contains the dropdown that is shown when the user can switch between different 
        // accounts, e.g. their own account and an organization. This selector works when an organization is selected.
        let settingsContainerElement = document.querySelector('.dashboard-sidebar > div > details');

        // If no element is found, the user might be on the dashboard of a non-orgnaization account. The selector needs
        // to be modified a bit for this, because the "details" element is nested under one more div then.
        if (!settingsContainerElement) {
            settingsContainerElement = document.querySelector('.dashboard-sidebar > div > div > details');
        }

        // If no "details" element is present, the user probably has only one account and therefore no dropdown.
        // A new div is added in front of the rest of the sidebar, to make sure the settings are added at the top.
        if (!settingsContainerElement) {
            settingsContainerElement = document.querySelector('.dashboard-sidebar > div');

            if (settingsContainerElement) {
                const dashboardTopDiv = document.createElement('div');
                settingsContainerElement.prepend(dashboardTopDiv);
                settingsContainerElement = dashboardTopDiv;
            }
        } else {
            // Use the parent element of the found "details" element, because the new HTML should be injected into the
            // same container and not into the "details" element itself.
            settingsContainerElement = settingsContainerElement.parentElement;
        }

        if (settingsContainerElement) {
            injectSettingsArea(settingsContainerElement);
            isSettingsAreaInjected = true;
        }
    }

    isHtmlInjected = isSettingsAreaInjected;
    if (isHtmlInjected && injectHtmlInterval) {
        clearTimeout(injectHtmlInterval);
    }
}

function injectSettingsArea(containerElement) {
    settingsAreaContainerDiv = document.createElement('div');
    settingsAreaContainerDiv.style.display = 'flex';
    settingsAreaContainerDiv.style.flexDirection = 'column';
    settingsAreaContainerDiv.style.marginTop = '10px';

    const settingsLabel = document.createElement('b');
    settingsLabel.appendChild(document.createTextNode(chrome.i18n.getMessage('settingsLabel')));

    settingsAreaContainerDiv.appendChild(settingsLabel);

    containerElement.appendChild(settingsAreaContainerDiv);

    injectTokenInput();
    injectSettingsInput();
}

function injectTokenInput() {
    if (!settingsAreaContainerDiv) {
        return;
    }

    const tokenInputContainerDiv = document.createElement('div');
    tokenInputContainerDiv.style.display = 'flex';
    tokenInputContainerDiv.style.flexDirection = 'column';
    tokenInputContainerDiv.style.marginLeft = '8px';

    const tokenInputLabelDiv = document.createElement('div');
    const tokenInputInputDiv = document.createElement('div');

    const tokenInputLabel = document.createElement('label');
    tokenInputLabel.appendChild(document.createTextNode(chrome.i18n.getMessage('tokenInputLabel') + ': '));

    accessTokenInput = document.createElement('input');
    accessTokenInput.classList.add('mr-1');

    accessTokenInputButton = document.createElement('button');
    accessTokenInputButton.classList.add('js-toggler-target', 'rounded-left-2', 'btn-sm', 'btn');

    accessTokenInputButtonText = document.createTextNode(chrome.i18n.getMessage('tokenInputButtonSubmitText'));

    accessTokenInputButton.appendChild(accessTokenInputButtonText);
    accessTokenInputButton.addEventListener('click', accessTokenButtonClicked);

    tokenInputLabelDiv.appendChild(tokenInputLabel);
    tokenInputInputDiv.appendChild(accessTokenInput);
    tokenInputInputDiv.appendChild(accessTokenInputButton);

    tokenInputContainerDiv.appendChild(tokenInputLabelDiv);
    tokenInputContainerDiv.appendChild(tokenInputInputDiv);

    settingsAreaContainerDiv.appendChild(tokenInputContainerDiv);
}

async function injectSettingsInput() {
    if (settingsAreaDiv) {
        settingsAreaDiv.remove();
    }

    settingsAreaDiv = document.createElement('div');
    settingsAreaDiv.style.marginLeft = '8px';
    settingsAreaContainerDiv.appendChild(settingsAreaDiv);

    if (!accessToken) {
        settingsAreaDiv.appendChild(document.createTextNode(chrome.i18n.getMessage('tokenNeededHint')));
        return;
    }

    const settingsDiv = document.createElement('div');

    const repoSelectContainerDiv = document.createElement('div');
    const repoSelectLabel = document.createElement('label');
    repoSelectLabel.appendChild(document.createTextNode(chrome.i18n.getMessage('repoFeedLabel') + ':'));
    const repoSelect = document.createElement('select');
    repoSelect.setAttribute('multiple', true);
    repoSelect.setAttribute('size', 8);
    repoSelect.style.maxWidth = '100%';
    repoSelect.style.overflowX = 'scroll';

    const loadingTextNode = getLoadingMessageTextNode();
    settingsAreaDiv.prepend(loadingTextNode);

    for (const repo of availableRepos) {
        const repoOption = document.createElement('option');
        repoOption.setAttribute('value', JSON.stringify({ id: repo.id, name: repo.name, owner: repo.owner.login }));
        repoOption.appendChild(document.createTextNode(repo.full_name));

        repoOption.style.margin = '4px';

        repoSelect.appendChild(repoOption);
    }

    settingsAreaDiv.removeChild(loadingTextNode);

    repoSelectContainerDiv.appendChild(repoSelectLabel);
    repoSelectContainerDiv.appendChild(repoSelect);
    settingsDiv.appendChild(repoSelectContainerDiv);

    settingsAreaDiv.appendChild(settingsDiv);

    repoSelect.addEventListener('change', reposSelected);
}

function injectNewFeed() {
    const feedDataContainerElement = document.querySelector('[data-hpc]');
    if (!feedDataContainerElement) {
        console.error('Didn\'t find container with feed data. GitHub probably changed their layout. :(');
        return;
    }

    feedDataContainerElement.replaceChildren();

    const loadingTextNode = getLoadingMessageTextNode();
    feedDataContainerElement.appendChild(loadingTextNode);

    return new Promise((resolve, reject) => {
        const repoLoadActivityPromises = [];
        selectedRepos.forEach(selectedRepo => {
            console.debug('loading data for repo ' + selectedRepo.name);

            const allRepoEventsPromise = new Promise((resolve, reject) => {
                const repoEventsResponses = {
                    repoEvents: null,
                    repoIssueEvents: null,
                };
                octokit.rest.activity.listRepoEvents({
                    owner: selectedRepo.owner,
                    repo: selectedRepo.name,
                })
                    .then((repoEventsData) => {
                        repoEventsResponses.repoEvents = repoEventsData;

                        // For some reason GitHub doesn't consider some issue events (like "added label" or
                        // "assigned user") as normal repository events, so they need to be fetched additionally.
                        octokit.rest.issues.listEventsForRepo({
                            owner: selectedRepo.owner,
                            repo: selectedRepo.name,
                        })
                            .then((repoIssueEventsData) => {
                                repoEventsResponses.repoIssueEvents = repoIssueEventsData;
                                resolve(repoEventsResponses);
                            })
                            .catch((error) => reject(error));
                    })
                    .catch((error) => reject(error));
            });

            repoLoadActivityPromises.push(allRepoEventsPromise);
        });

        Promise.all(repoLoadActivityPromises)
            .then((promiseDatas) => {
                const repoFeedDivs = [];
                for (let promiseDataIndex = 0; promiseDataIndex < promiseDatas.length; promiseDataIndex++) {
                    // Order of repos in `selectedRepos` matches the order of data in `promiseDatas` because the order
                    // of the return values of Promise.all matches the order of the promises in `repoLoadActivityPromises`.
                    const repoFullName = selectedRepos[promiseDataIndex].owner + '/' + selectedRepos[promiseDataIndex].name;

                    const promiseData = promiseDatas[promiseDataIndex];
                    const dataRepoEvents = promiseData.repoEvents.data;
                    const dataRepoIssueEvents = promiseData.repoIssueEvents.data;

                    console.debug(
                        'fetched ' + (dataRepoEvents.length + dataRepoIssueEvents.length)
                        + ' data entries for repo ' + repoFullName
                    );
                    console.debug('fetched repo events data:');
                    console.debug(dataRepoEvents);
                    console.debug('fetched repo issue events data:');
                    console.debug(dataRepoIssueEvents);

                    // "Repo issue events" unfortunately have a slightly different format then "normal" repo events.
                    // To handle them together, all repo issue events are transformed into a different form here to
                    // resemble the format of normal repo events.
                    dataRepoIssueEvents.forEach((issueEvent) => {
                        // Some issue events are a bit too specific or would clutter the dashboard.
                        // They are filtered here.
                        if ([
                            'added_to_project',
                            'automatic_base_change_failed',
                            'automatic_base_change_succeeded',
                            'base_ref_changed',
                            'commented', // Already handled via IssueCommentEvents (hopefully).
                            'committed',
                            'connected',
                            'convert_to_draft',
                            'converted_note_to_issue',
                            'converted_to_discussion',
                            'cross-referenced',
                            'demilestoned',
                            'deployed',
                            'deployment_environment_changed',
                            'disconnected',
                            'head_ref_deleted',
                            'head_ref_restored',
                            'head_ref_force_pushed',
                            'locked',
                            'mentioned',
                            'marked_as_duplicate',
                            'milestoned',
                            'moved_columns_in_project',
                            'pinned',
                            'referenced',
                            'removed_from_project',
                            'renamed',
                            'review_dismissed',
                            'review_requested', // Already handled via pull request events.
                            'review_request_removed',
                            'reviewed', // Already handled via pull request events.
                            'subscribed',
                            'transferred',
                            'unlocked',
                            'unmarked_as_duplicate',
                            'unpinned',
                            'unsubscribed',
                            'user_blocked',
                        ].includes(issueEvent.event)) {
                            return;
                        }

                        const transformedEvent = {};
                        transformedEvent.actor = issueEvent.actor;
                        transformedEvent.id = issueEvent.id;
                        transformedEvent.created_at = issueEvent.created_at;
                        transformedEvent.type = 'IssuesEvent';
                        transformedEvent.payload = issueEvent;
                        transformedEvent.payload.action = issueEvent.event;

                        dataRepoEvents.push(transformedEvent);
                    });

                    dataRepoEvents.sort(function(eventA, eventB){
                        return eventB.created_at.localeCompare(eventA.created_at);
                    });

                    console.debug('filtered combined events data:');
                    console.debug(dataRepoEvents);

                    const repoFeedDiv = document.createElement('div');
                    repoFeedDivs.push(repoFeedDiv);

                    const repoLabel = document.createElement('label');
                    repoLabel.appendChild(document.createTextNode(repoFullName));
                    repoFeedDiv.appendChild(repoLabel);

                    const dataDivsContainer = document.createElement('div');
                    dataDivsContainer.classList.add('mb-3');
                    repoFeedDiv.appendChild(dataDivsContainer);

                    if (dataRepoEvents.length == 0) {
                        dataDivsContainer.appendChild(document.createTextNode(chrome.i18n.getMessage('noActivityFoundMessage')));
                        continue;
                    }

                    // TODO: Implement display of all data with proper design
                    // TODO: Probably move some of this stuff into own functions (e.g. "createUserAvatar")
                    dataRepoEvents.forEach((eventData) => {
                        // The CSS classes used here are taken from the original GitHub feed entries.
                        // They also use different classes than the ones used here, however it seems that all of them
                        // look the same in the end, so we probably don't have to care.
                        const dataDiv = document.createElement('div');
                        dataDiv.classList.add('body');

                        const detailsDiv = document.createElement('div');
                        detailsDiv.classList.add('Details');
                        dataDiv.appendChild(detailsDiv);

                        const flexItemDiv = document.createElement('div');
                        flexItemDiv.classList.add('d-flex', 'flex-items-baseline', 'py-4');
                        detailsDiv.appendChild(flexItemDiv);

                        const actualDataContainerDiv = document.createElement('div');
                        actualDataContainerDiv.classList.add('d-flex', 'flex-column', 'flex-1');
                        actualDataContainerDiv.style.minWidth = 0;
                        flexItemDiv.appendChild(actualDataContainerDiv);

                        const contentTopDiv = document.createElement('div');
                        contentTopDiv.classList.add('d-flex', 'flex-justify-between', 'flex-items-baseline');
                        actualDataContainerDiv.appendChild(contentTopDiv);

                        const contentHeaderDiv = document.createElement('div');
                        contentHeaderDiv.classList.add('color-fg-muted');
                        contentTopDiv.appendChild(contentHeaderDiv);

                        const avatarSpan = document.createElement('span');
                        avatarSpan.classList.add('mr-2');
                        contentHeaderDiv.appendChild(avatarSpan);

                        const avatarAnchor = document.createElement('a');
                        avatarAnchor.classList.add('d-inline-block');
                        avatarAnchor.setAttribute('data-hovercard-type', 'user');
                        avatarAnchor.setAttribute('data-hovercard-url', '/users/' + eventData.actor.login + '/hovercard');
                        avatarAnchor.setAttribute('data-octo-clicked', 'hovercard-link-clicked');
                        avatarAnchor.setAttribute('data-octo-dimensions', 'link_type:self');
                        avatarAnchor.href = '/' + eventData.actor.login;
                        avatarSpan.appendChild(avatarAnchor);

                        const avatarImg = document.createElement('img');
                        avatarImg.classList.add('avatar', 'avatar-user');
                        avatarImg.src = eventData.actor.avatar_url;
                        avatarImg.width = 32;
                        avatarImg.height = 32;
                        avatarImg.alt = eventData.actor.login;
                        avatarAnchor.appendChild(avatarImg);

                        const userNameAnchor = document.createElement('a');
                        userNameAnchor.classList.add('Link--primary', 'no-underline', 'wb-break-all');
                        userNameAnchor.setAttribute('data-hovercard-type', 'user');
                        userNameAnchor.setAttribute('data-hovercard-url', '/users/' + eventData.actor.login + '/hovercard');
                        userNameAnchor.setAttribute('data-octo-clicked', 'hovercard-link-clicked');
                        userNameAnchor.setAttribute('data-octo-dimensions', 'link_type:self');
                        userNameAnchor.href = '/' + eventData.actor.login;
                        userNameAnchor.appendChild(document.createTextNode(eventData.actor.login));
                        contentHeaderDiv.appendChild(userNameAnchor);

                        contentHeaderDiv.appendChild(document.createTextNode(' ' + getEventActionText(eventData) + ' '));

                        const eventActionTargetElements = getEventActionTargetElements(eventData, repoFullName);
                        eventActionTargetElements.forEach((eventTargetElement) => contentHeaderDiv.appendChild(eventTargetElement));

                        // flexItemDiv.appendChild(document.createTextNode(JSON.stringify(eventData)));

                        dataDivsContainer.appendChild(dataDiv);
                    });
                }

                repoFeedDivs.forEach((repoFeedDiv) => feedDataContainerElement.appendChild(repoFeedDiv));
                resolve();
            })
            .catch((error) => {
                feedDataContainerElement.appendChild(getErrorWhileLoadingDataTextNode());
                reject(error);
            })
            .finally(() => {
                loadingTextNode.remove();
            });
    });
}

// TODO: Add translations
function getEventActionText(eventData) {
    switch (eventData.type) {
        case 'CommitCommentEvent':
            return 'commented on commit';
        case 'CreateEvent':
            return 'created ' + (eventData.payload.ref_type == 'tag' ? 'tag' : 'branch');
        case 'DeleteEvent':
            return 'deleted ' + (eventData.payload.ref_type == 'tag' ? 'tag' : 'branch');
        case 'ForkEvent':
            return 'forked this repo as';
        case 'GollumEvent':
            return 'modified wiki page';
        case 'IssueCommentEvent': {
            // For some reason, comments on pull requests might trigger an IssueCommentEvent but will add an additional
            // pull_request object to the issue object.
            const issueCommentType = eventData.payload.issue.pull_request ? 'pull request' : 'issue';

            switch (eventData.payload.action) {
                case 'created':
                    return 'commented on ' + issueCommentType;
                case 'edited':
                    return 'edited comment on ' + issueCommentType;
                case 'deleted':
                    return 'removed comment from ' + issueCommentType;
                default:
                    return 'did something with a comment on ' + issueCommentType;
            }
        }
        case 'IssuesEvent':
            // Note: PRs sometimes are also handled via IssueEvent by GitHub.
            switch (eventData.payload.action) {
                case 'opened':
                    return 'opened issue';
                case 'edited':
                    return 'edited issue';
                case 'closed':
                    return 'closed issue';
                case 'reopened':
                    return 'reopened issue';
                case 'assigned':
                    return 'assigned issue';
                case 'unassigned':
                    return 'unassigned issue';
                case 'labeled':
                    return 'added label to issue';
                case 'unlabeled':
                    return 'removed label from issue';
                case 'merged':
                    return 'merged pull request';
                case 'ready_for_review':
                    return 'marked pull request';
                default:
                    return 'did something with issue'
            }
        case 'MemberEvent':
            switch (eventData.payload.action) {
                case 'added':
                    return 'added new collaborator';
                case 'edited':
                    return 'changed collaborator permissions for user';
                default:
                    return 'performed some administrative action for user';
            }
        case 'PublicEvent':
            return 'made this repository public';
        case 'PullRequestEvent':
            switch (eventData.payload.action) {
                case 'opened':
                    return 'opened pull request';
                case 'edited':
                    return 'edited pull request';
                case 'closed':
                    return 'closed pull request';
                case 'reopened':
                    return 'reopened pull request';
                case 'assigned':
                    return 'assigned pull request';
                case 'unassigned':
                    return 'unassigned pull request';
                case 'review_requested':
                    return 'requested review for pull request';
                case 'review_request_removed':
                    return 'removed request for review from pull request';
                case 'labeled':
                    return 'added label to pull request';
                case 'unlabeled':
                    return 'removed label from pull request';
                case 'synchronized':
                    return 'synchronized pull request';
                default:
                    return 'did something with pull request'
            }
        case 'PullRequestReviewEvent':
            switch (eventData.payload.review.state) {
                case 'changes_requested':
                    return 'requested changes on pull request';
                case 'approved':
                    return 'approved pull request';
                default:
                    return 'reviewed pull request'
            }
        case 'PullRequestReviewCommentEvent':
            switch (eventData.payload.action) {
                case 'edited':
                    return 'edited comment on pull request';
                case 'created':
                default:
                    return 'commented on pull request';
            }
        case 'PullRequestReviewThreadEvent':
            switch (eventData.payload.action) {
                case 'resolved':
                    return 'resolved thread';
                case 'unresolved':
                    return 'unresolved thread';
                default:
                    return 'did something with thread';
            }
        case 'PushEvent':
            return 'pushed to';
        case 'ReleaseEvent':
            switch (eventData.payload.action) {
                case 'published':
                    return 'published release';
                case 'edited':
                    return 'edited release';
                default:
                    return 'did something with release';
            }
        case 'SponsorshipEvent':
            switch (eventData.payload.action) {
                case 'created':
                    return 'added a sponsorship';
                case 'edited':
                    return 'edited their sponsorship';
                default:
                    return 'did something with their sponsorship';
            }
        case 'WatchEvent':
            return 'starred the repository';
        default:
            console.warn('Unknown event type: ' + eventData.type);
            return 'did something';
    }
}

// Will return an array with all HTML elements that are required to show the action target of an event.
// In most cases this array only contains one anchor element that links to e.g. a PR. However, sometimes it will contain
// multiple elements (e.g. if branch was deleted it cannot be linked anymore so it's the branches name but with an
// anchor that links to the repo).
// TODO: Add all types (or try at least :D)
// TODO: Add translations
function getEventActionTargetElements(eventData, repoFullName) {
    // Almost all events need at least one anchor element or a text node.
    const eventActionAnchor = document.createElement('a');
    eventActionAnchor.classList.add('Link--primary');

    const eventActionSpan = document.createElement('span');
    eventActionSpan.classList.add('color-fg-default');

    switch (eventData.type) {
        case 'CommitCommentEvent':
            eventActionAnchor.href = eventData.payload.comment.html_url;
            eventActionAnchor.appendChild(document.createTextNode(eventData.payload.comment.commit_id));
            return [eventActionAnchor];
        case 'CreateEvent':
            if (!eventData.payload.ref) {
                eventActionSpan.appendChild(document.createTextNode('(not accessible anymore)'));
                return [eventActionSpan];
            }

            eventActionAnchor.href = gitHubBaseUrl + repoFullName + '/tree/' + eventData.payload.ref;
            eventActionAnchor.appendChild(document.createTextNode(eventData.payload.ref));
            return [eventActionAnchor];
        case 'DeleteEvent':
            if (!eventData.payload.ref) {
                eventActionSpan.appendChild(document.createTextNode('(not accessible anymore)'));
            } else {
                eventActionSpan.appendChild(document.createTextNode(eventData.payload.ref));
            }

            return [eventActionSpan];
        case 'ForkEvent': {
            const forkedRepoFullName = eventData.payload.full_name;
            eventActionAnchor.href = gitHubBaseUrl + forkedRepoFullName;
            eventActionAnchor.appendChild(document.createTextNode(forkedRepoFullName));
            return [eventActionAnchor];
        }
        case 'GollumEvent': { // Gollum is the software that is used to run wikis on GitHub.
            if (!eventData.payload.pages || eventData.payload.pages.length == 0) {
                eventActionSpan.appendChild(document.createTextNode('(wiki pages not found)'));
                return [eventActionSpan];
            }

            const wikiPageEventActionTarget = [];
            for (let wikiPageIndex = 0;wikiPageIndex < eventData.payload.pages.length;wikiPageIndex++) {
                const wikiPage = eventData.payload.pages[wikiPageIndex];

                const wikiPageEventActionAnchor = document.createElement('a');
                wikiPageEventActionAnchor.classList.add('Link--primary');
                wikiPageEventActionAnchor.href = wikiPage.html_url;
                eventActionAnchor.setAttribute('title', wikiPage.title);
                wikiPageEventActionAnchor.appendChild(document.createTextNode(wikiPage.page_name));

                wikiPageEventActionTarget.push(wikiPageEventActionAnchor);

                // Add commas to seperate pages in the resulting text.
                if (wikiPageIndex < eventData.payload.pages.length - 1) {
                    wikiPageEventActionTarget.push(document.createTextNode(', '));
                }
            }

            return wikiPageEventActionTarget;
        }
        case 'IssueCommentEvent':
            eventActionAnchor.href = eventData.payload.comment.html_url;
            eventActionAnchor.setAttribute('title', eventData.payload.issue.title);
            eventActionAnchor.appendChild(document.createTextNode('#' + eventData.payload.issue.number));
            return [eventActionAnchor];
        case 'IssuesEvent':
            // Sometimes the issue data is referring to a pull request, but although the issue object then has a
            // "pull_request" attribute, the url, title etc. stored directly in the issue object, already refer to the PR.
            eventActionAnchor.href = eventData.payload.issue.html_url;
            eventActionAnchor.setAttribute('title', eventData.payload.issue.title);
            eventActionAnchor.appendChild(document.createTextNode('#' + eventData.payload.issue.number));

            // TODO: Check if "pull_request" is present in the event, because some events seem to be for pull requests event thought they should be poull request events.
            switch (eventData.payload.action) {
                case 'opened':
                case 'edited':
                case 'closed':
                case 'reopened':
                case 'labeled':
                case 'unlabeled':
                case 'merged': // Only for PRs
                    return [eventActionAnchor];
                case 'assigned': {
                    const toUserSpan = document.createElement('span');
                    toUserSpan.appendChild(document.createTextNode(' to user '));

                    const assignedUserAnchor = document.createElement('a');
                    assignedUserAnchor.classList.add('Link--primary');
                    assignedUserAnchor.setAttribute('data-hovercard-type', 'user');
                    assignedUserAnchor.setAttribute('data-hovercard-url', '/users/' + eventData.payload.assignee.login + '/hovercard');
                    assignedUserAnchor.setAttribute('data-octo-clicked', 'hovercard-link-clicked');
                    assignedUserAnchor.setAttribute('data-octo-dimensions', 'link_type:self');
                    assignedUserAnchor.href = eventData.payload.assignee.html_url;
                    assignedUserAnchor.setAttribute('title', eventData.payload.assignee.login);
                    assignedUserAnchor.appendChild(document.createTextNode(eventData.payload.assignee.login));

                    return [eventActionAnchor, toUserSpan, assignedUserAnchor];
                }
                case 'unassigned': {
                    const fromUserSpan = document.createElement('span');
                    fromUserSpan.appendChild(document.createTextNode(' from user '));

                    const unassignedUserAnchor = document.createElement('a');
                    unassignedUserAnchor.classList.add('Link--primary');
                    unassignedUserAnchor.setAttribute('data-hovercard-type', 'user');
                    unassignedUserAnchor.setAttribute('data-hovercard-url', '/users/' + eventData.payload.assignee.login + '/hovercard');
                    unassignedUserAnchor.setAttribute('data-octo-clicked', 'hovercard-link-clicked');
                    unassignedUserAnchor.setAttribute('data-octo-dimensions', 'link_type:self');
                    unassignedUserAnchor.href = eventData.payload.assignee.html_url;
                    unassignedUserAnchor.setAttribute('title', eventData.payload.assignee.login);
                    unassignedUserAnchor.appendChild(document.createTextNode(eventData.payload.assignee.login));

                    return [eventActionAnchor, fromUserSpan, unassignedUserAnchor];
                }
                case 'ready_for_review': {
                    const additionalTextSpan = document.createElement('span');
                    additionalTextSpan.appendChild(document.createTextNode(' as ready for review'));
                    return [eventActionAnchor, additionalTextSpan];
                }
                default:
                    return [eventActionAnchor];
            }
        case 'MemberEvent':
            eventActionAnchor.setAttribute('data-hovercard-type', 'user');
            eventActionAnchor.setAttribute('data-hovercard-url', '/users/' + eventData.payload.member.login + '/hovercard');
            eventActionAnchor.setAttribute('data-octo-clicked', 'hovercard-link-clicked');
            eventActionAnchor.setAttribute('data-octo-dimensions', 'link_type:self');
            eventActionAnchor.href = eventData.payload.member.html_url;
            eventActionAnchor.setAttribute('title', eventData.payload.member.login);
            eventActionAnchor.appendChild(document.createTextNode(eventData.payload.member.login));

            switch (eventData.payload.action) {
                case 'added':
                    return [eventActionAnchor];
                case 'edited':
                    return [eventActionAnchor];
                default:
                    return [eventActionAnchor];
            }
        case 'PublicEvent':
            return [];
        case 'PullRequestEvent':
            eventActionAnchor.href = eventData.payload.pull_request.html_url;
            eventActionAnchor.setAttribute('title', eventData.payload.pull_request.title);
            eventActionAnchor.appendChild(document.createTextNode('#' + eventData.payload.number));

            switch (eventData.payload.action) {
                case 'opened':
                case 'edited':
                case 'closed':
                case 'reopened':
                case 'review_requested':
                case 'review_request_removed':
                case 'labeled':
                case 'unlabeled':
                case 'synchronized':
                    return [eventActionAnchor];
                case 'assigned': {
                    const toUserSpan = document.createElement('span');
                    toUserSpan.appendChild(document.createTextNode(' to user '));

                    const assignedUserAnchor = document.createElement('a');
                    assignedUserAnchor.classList.add('Link--primary');
                    assignedUserAnchor.setAttribute('data-hovercard-type', 'user');
                    assignedUserAnchor.setAttribute('data-hovercard-url', '/users/' + eventData.payload.assignee.login + '/hovercard');
                    assignedUserAnchor.setAttribute('data-octo-clicked', 'hovercard-link-clicked');
                    assignedUserAnchor.setAttribute('data-octo-dimensions', 'link_type:self');
                    assignedUserAnchor.href = eventData.payload.assignee.html_url;
                    assignedUserAnchor.setAttribute('title', eventData.payload.assignee.login);
                    assignedUserAnchor.appendChild(document.createTextNode(eventData.payload.assignee.login));

                    return [eventActionAnchor, toUserSpan, assignedUserAnchor];
                }
                case 'unassigned': {
                    const fromUserSpan = document.createElement('span');
                    fromUserSpan.appendChild(document.createTextNode(' from user '));

                    const unassignedUserAnchor = document.createElement('a');
                    unassignedUserAnchor.classList.add('Link--primary');
                    unassignedUserAnchor.setAttribute('data-hovercard-type', 'user');
                    unassignedUserAnchor.setAttribute('data-hovercard-url', '/users/' + eventData.payload.assignee.login + '/hovercard');
                    unassignedUserAnchor.setAttribute('data-octo-clicked', 'hovercard-link-clicked');
                    unassignedUserAnchor.setAttribute('data-octo-dimensions', 'link_type:self');
                    unassignedUserAnchor.href = eventData.payload.assignee.html_url;
                    unassignedUserAnchor.setAttribute('title', eventData.payload.assignee.login);
                    unassignedUserAnchor.appendChild(document.createTextNode(eventData.payload.assignee.login));

                    return [eventActionAnchor, fromUserSpan, unassignedUserAnchor];
                }
                default:
                    return [eventActionAnchor];
            }
        case 'PullRequestReviewEvent':
        case 'PullRequestReviewCommentEvent':
            eventActionAnchor.href = eventData.payload.comment ? eventData.payload.comment.html_url : eventData.payload.review.html_url;
            eventActionAnchor.setAttribute('title', eventData.payload.pull_request.title);
            eventActionAnchor.appendChild(document.createTextNode('#' + eventData.payload.pull_request.number));
            return [eventActionAnchor];
        case 'PullRequestReviewThreadEvent': {
            const prAnchor = document.createElement('a');
            prAnchor.classList.add('Link--primary');
            prAnchor.href = eventData.payload.pull_request.html_url;
            prAnchor.setAttribute('title', eventData.payload.pull_request.title);
            prAnchor.appendChild(document.createTextNode('#' + eventData.payload.number));

            const onPrSpan = document.createElement('span');
            onPrSpan.appendChild(document.createTextNode(' on pull request '));

            // TODO: I was not able to get events for threads so for now the thread object of the event is not used here.
            return [onPrSpan, prAnchor];
        }
        case 'PushEvent':
            console.log(eventData);
            return [eventActionAnchor];
        case 'ReleaseEvent':
            switch (eventData.payload.action) {
                case 'published':
                    return [eventActionAnchor];
                case 'edited':
                    return [eventActionAnchor];
                default:
                    return [eventActionAnchor];
            }
        case 'SponsorshipEvent':
            switch (eventData.payload.action) {
                case 'created':
                    return [eventActionAnchor];
                case 'edited':
                    return [eventActionAnchor];
                default:
                    return [eventActionAnchor];
            }
        case 'WatchEvent':
            return [eventActionAnchor];
        default:
            console.warn('Unknown event type: ' + eventData.type);
            return [eventActionAnchor];
    }
}

function getLoadingMessageTextNode() {
    return document.createTextNode(chrome.i18n.getMessage('loadingMessage'));
}

function getErrorWhileLoadingDataTextNode() {
    return document.createTextNode(chrome.i18n.getMessage('errorWhileLoadingData'));
}

/*
################################
### Event Handling Functions ###
################################
*/

function accessTokenButtonClicked() {
    if (accessToken) {
        resetAccessToken();
    } else {
        getAccessTokenAndFetchRepos();
    }
}

function reposSelected(event) {
    if (repoSelectionDebounceTimeout != null) {
        clearTimeout(repoSelectionDebounceTimeout);
    }

    repoSelectionDebounceTimeout = setTimeout(() => {
        selectedRepos.length = 0;
        for (let optionIndex = 0; optionIndex < event.target.selectedOptions.length; optionIndex++) {
            selectedRepos.push(JSON.parse(event.target.selectedOptions[optionIndex].value));
        }
    
        injectNewFeed();
    }, 1000);
}

async function getAccessTokenAndFetchRepos() {
    if (!accessTokenInput || !accessTokenInputButton) {
        return;
    }

    const userEnteredToken = accessTokenInput.value;

    if (!userEnteredToken) {
        return;
    }

    if (accessTokenErrorParagraph) {
        accessTokenErrorParagraph.remove();
    }

    octokit = new Octokit({ 'auth': userEnteredToken });

    availableRepos.length = 0;
    try {
        const repoListResponse = await octokit.rest.repos.listForAuthenticatedUser();
        for (let repo of repoListResponse.data) {
            availableRepos.push(repo);
        }
    } catch (error) {
        // Most likely the token is wrong or expired.
        console.log('Error while fetching repos for this user:')
        console.log(error);

        if (settingsAreaDiv) {
            accessTokenErrorParagraph = document.createElement('p');
            accessTokenErrorParagraph.classList.add('color-fg-danger');
            accessTokenErrorParagraph.appendChild(document.createTextNode(error.message));
            settingsAreaDiv.prepend(accessTokenErrorParagraph);

            accessTokenInput.value = '';
        }

        return;
    }

    accessToken = userEnteredToken;

    accessTokenInput.disabled = true;
    accessTokenInput.value = '***************';

    accessTokenInputButtonText.textContent = chrome.i18n.getMessage('tokenInputButtonResetText');

    injectSettingsInput();
}

function resetAccessToken() {
    if (!accessTokenInput || !accessTokenInputButton) {
        return;
    }

    accessToken = null;
    availableRepos.length = 0;
    selectedRepos.length = 0;

    injectNewFeed();

    accessTokenInput.disabled = false;
    accessTokenInput.value = '';

    accessTokenInputButtonText.textContent = chrome.i18n.getMessage('tokenInputButtonSubmitText');

    injectSettingsInput();
}
