# Weeekly — Planning

Status: Discovery / Pre-planning

This is an intake doc, not a spec yet. Fill in what you can — skip anything you're unsure about and we'll figure it out together.

## 1. The Idea

_One or two sentences: what is Weeekly?_
Weeekly is an app/bot to read and inform parents of school activities for the week. Parents receive lots of emails every week and it's hard to keep track of everything (for example, an activity on a Wednesday might require sending over change for a tuck shop purchase) and the objective is to have Claude read the latest emails from school and provide a summary every Sunday evening.

## 2. Problem & Motivation

- Weeekly help parents plan for the weekly school activities for their children
- School sends multiple emails every week and it is hard to keep track of every single thing that will happen
- Weeekly summarises and alerts parents every Sunday (and should also send the odd-alert during the week if needed)


## 3. Users & Use Cases

- Weeekly will read emails from a mailbox, have claude analise them, and generate a summary
- Weeekly will start with just Year 3 activities
- Users are parents of Y3 children
- Notifications will be sent by a Telegram bot initially (v1)

## 4. Core Features (MVP)

- Telegram bot
- Users will get a notification from the bot every Sunday 5PM with the next week school activities, events and whatever else might require parent's attention/action
- Other year groups are out of scope
- An alert on demand should also be created (i.e. a user missed the Sunday message and requests one Monday morning)

## 5. Platform & Tech

- Telegram bot
- Hosting with Vercel (free tier)
- Tech stack should be python (or other recommended by claude, to be approved)
- Emails will be read from a Zoho Mail account (created only for this purpose)

## 6. Data & Integrations

- NoSQL probably with days and activities for that day
- No calendar sync or integrations for v1
- Claude to propose an schema (maybe analise the emails first)

## 7. Design & UX

- The alert should come in a single message with a list of the following days
- Maybe start with activities that already happened in the previous week (as a reminder)
- Each line should be a day of the next week with the activities
- Actions in bold so users don't miss them

## 8. Constraints

- Use the Vercel free tier only

## 9. Success Criteria

- Claude is analising the emails
- Telegram bot is ready

## 10. Open Questions

- Nothing yet