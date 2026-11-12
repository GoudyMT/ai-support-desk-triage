import { CLOSERS, OPENERS, REQUESTS } from './templates';
import type { Wording } from './wording';

// A second, independent set of ticket wording. It differs from the first set in
// length (one-liners up to long back-stories), in how much detail a writer gives,
// in voice and in the situations it covers, so a model trained on both sees many
// more distinct cases than one trained on a single small set of similar sentences.
export const EXTRA_WORDING: Wording = {
  templates: {
    Billing: [
      // severe + billingDispute + grievance
      { text: 'Cancelled the {plan} in March, charged {amount} anyway. Refund it.', severe: true, billingDispute: true, grievance: true },
      {
        text: 'My bank shows {amount} taken twice on {date} for the same {plan} seat. One of them has to go back to me, because the overdraft fees are now on me.',
        severe: true,
        billingDispute: true,
        grievance: true,
      },
      {
        text: 'We run a small shop and the {plan} bill landed on the company card three times in one week. Each one was {amount}. I called my bank and they say only you can reverse them. Until that happens we cannot buy stock, so I need the money back now.',
        severe: true,
        billingDispute: true,
        grievance: true,
      },
      {
        text: 'I have used {product} for six years without a single payment problem, which is why this is so frustrating. On {date} I closed my {plan} from the settings page and saw the confirmation screen. Four days later my card was charged {amount}. I wrote to you, and a reply said the cancellation had "not completed". Then a second {amount} appeared this morning. My card limit is nearly reached because of this, and I have a supplier to pay on Friday. I want both charges reversed and written confirmation that nothing else will be taken.',
        severe: true,
        billingDispute: true,
        grievance: true,
      },
      // billingDispute only
      { text: 'I dispute the {amount} charge from {date}.', billingDispute: true },
      {
        text: 'The {plan} was meant to be {amount} a month, yet the last three statements show a higher number. I would like the extra amounts reviewed and returned if they are an error.',
        billingDispute: true,
      },
      {
        text: 'My currency is euros but the {amount} was taken in dollars at a poor rate. Can you reverse it and rebill in euros? I would like to contest the difference.',
        billingDispute: true,
      },
      {
        text: 'A seat count of 12 was applied to the {plan} this cycle, but we only have 9 people. I removed three users on {date}, before the cycle began. The invoice still bills all 12. Please correct the count and credit the difference.',
        billingDispute: true,
      },
      // grievance only
      { text: 'Still waiting on my corrected invoice. This is getting silly.', grievance: true },
      {
        text: 'The invoice dated {date} still shows our old company name, even though I sent the new one weeks ago. Our auditors will not accept it and I am fed up with asking for a corrected copy.',
        grievance: true,
      },
      {
        text: 'Our purchase order number was meant to appear on every invoice for the {plan}. It has been missing for four months, and our payables office rejects anything without it. Each time I ask, I get a promise and no corrected invoice. It is making me look careless to my own finance people.',
        grievance: true,
      },
      {
        text: 'Our company moved to a new bank in the spring, and I told you about it the day it happened. You replied that the payment details were updated. Since then two {plan} payments have bounced, which I only learned from reminder emails and not from you. Last week a late-payment notice arrived for both invoices. We are not late, we are the ones who sent the new details. Put the new bank details on the billing record, take the late marks off those two invoices, and send me the corrected statements. It is frustrating to chase this for a third month.',
        grievance: true,
      },
      // no flag
      { text: 'Do you accept purchase orders for the {plan}?' },
      { text: 'My card on file expires next month. Where do I put the new number so the {plan} renews without a gap?' },
      { text: 'We want to add four seats to the {plan} part way through the cycle. Will the extra cost be prorated for the days left?' },
      {
        text: 'Our head office is in Germany and our invoices need to show a VAT number. I entered it in settings but the last invoice is blank in that spot. Could you tell me where it is stored? We are not disputing anything, we just need the right layout for our tax filing.',
      },
    ],
    'Technical Issue': [
      // severe + grievance
      { text: 'Launch screen of {product} hangs forever, deadline is today.', severe: true, grievance: true },
      {
        text: 'Every file I saved in {product} since Monday is now unreadable. Years of work are sitting in there and I cannot open any of it.',
        severe: true,
        grievance: true,
      },
      {
        text: 'After the update on {date}, the shared workbook in {product} shows blank rows where our figures were. We have 40 people who rely on it. Restoring from the history tab gives the same blank view. Nobody has been able to work for hours and I am running out of patience.',
        severe: true,
        grievance: true,
      },
      {
        text: 'I am a field engineer and {product} on my work tablet is the only way I get my job sheets. Since {date} it opens, shows the spinner, and closes by itself. I removed and reinstalled it, restarted the tablet, and tried on mobile data instead of the office network. The same thing happens each time. My colleague has the same model and hers works, so I think it is something about my copy of the app. I have jobs waiting and customers calling the depot. I need this fixed today because I cannot do anything without it. Every hour matters here.',
        severe: true,
        grievance: true,
      },
      // severe only
      { text: 'Nothing in {product} will load for our whole office since 9am.', severe: true },
      {
        text: 'The payroll export in {product} produces an empty file, and payroll must be submitted by {date}. I have tried it from two computers.',
        severe: true,
      },
      {
        text: '"Database unavailable, retry later" is all I see when I open {product}. It has said that for {days} days and no one on my team can get to the client files.',
        severe: true,
      },
      {
        text: 'We use {product} to run the checkout screens in our shop. At about noon the screens went white and now show a message about a certificate. Staff are writing down sales on paper. Could someone check whether the problem is on your side? Customers are queueing.',
        severe: true,
      },
      // grievance only
      { text: 'The new layout in {product} is slower than the old one again.', grievance: true },
      {
        text: 'Every time I rotate my phone, {product} jumps back to the first screen. I reported this last month and the update since then did not fix it.',
        grievance: true,
      },
      {
        text: 'I keep getting a spinning wheel when I filter by date in {product}. It does work after about {seconds} seconds, but that is far too long for something so basic. Other people in the office say the same. I had hoped the last release would sort it out.',
        grievance: true,
      },
      {
        text: 'The calendar sync in {product} has been wrong since the clocks changed. Meetings I create at 10 appear at 9 on the screens of my colleagues. I have fixed the time zone setting in three places. Each fix lasts a day and then it reverts. I have sent screenshots of the settings page and of the two calendars side by side. Somebody told me it was a known issue but gave no date. I am fed up with explaining it. Meetings are being missed because of it.',
        grievance: true,
      },
      // no flag
      { text: 'The font in {product} looks blurry on my second monitor.' },
      { text: 'When I paste a table from a spreadsheet into {product}, the columns end up in one cell. Is that how it should work?' },
      { text: 'The sidebar in {product} does not remember that I collapsed it. I tried two different browsers and both do the same.' },
      {
        text: 'I opened {product} on my old laptop today, running a version of the operating system from about five years ago. The menus draw twice and the second copy sits slightly off. It does not stop me working, I just wanted to report it in case it helps. The graphics driver is up to date as far as I can tell.',
      },
    ],
    'Account Access': [
      // grievance (8)
      { text: 'Reset link says expired the moment I click it.', grievance: true },
      { text: 'Single sign-on loops back to the start every time.', grievance: true },
      {
        text: 'Our admin left the company in May and nobody knows the owner password. We cannot add anyone or change anything and it is becoming a real problem.',
        grievance: true,
      },
      {
        text: 'I get "this device is not recognised" on my new laptop, and the code it says it sent never arrives. I have waited twenty minutes.',
        grievance: true,
      },
      {
        text: 'The text message code goes to a number I stopped using in the spring. I told you about the change months ago and it is still the old one.',
        grievance: true,
      },
      {
        text: 'Our two firms merged last month and everyone now has a new company email address. The old addresses stopped working in {product} on {date}. When we try the new ones the system says no such user exists. Half the team has been locked out since, and the other half is sharing screens.',
        grievance: true,
      },
      {
        text: 'I come back to {product} every year in tax season, so I only use it for about six weeks. This year I could not get in. The sign-in page says my password is wrong, and the reset email shows up but the link does nothing. I tried a different browser and my phone. I also tried the email address I think I used before, and a second one. Each gave a slightly different error. I have a filing deadline in {days} days and all my records are in there. I am not technical and I do not know what else to try.',
        grievance: true,
      },
      {
        text: 'I turned on two-step sign-in last week to be safe. Now my phone is in for repair and I cannot receive the codes. The backup codes I printed are in a drawer at my old flat. I cannot see any way to get past this screen, and I have been stuck all morning.',
        grievance: true,
      },
      // no flag (8)
      { text: 'How do I link my work email to my existing login?' },
      { text: 'The sign-in page has refused my password since this morning.' },
      {
        text: 'I am the new office manager and the previous admin left a note saying to ask you for the owner role. What do you need from me?',
      },
      {
        text: 'The password reset link sat in a spam folder for a day and now the page says it has expired. I still cannot get in.',
      },
      {
        text: 'We moved everyone to sign in with our company directory last week. Since then three people are sent back to the sign-in page every time and cannot reach their workspace.',
      },
      {
        text: 'My surname changed after my wedding and my work email now has a new spelling. I would like the name on my login to match. I am not sure whether I should make a new login or change the existing one. I do not want to lose my saved reports.',
      },
      {
        text: 'We are a school and each class shares one tablet. Students sign in on it one after another. Since {date} the second student of the day is always refused with a message that the session is still in use, and only a full restart lets them in. Each lesson loses ten minutes to it.',
      },
      {
        text: 'I help my father with his computer. He has used {product} for years but he has never set up anything on it himself, because my brother did that long ago. My brother has moved abroad and does not answer messages. Dad has forgotten the email address he used. He knows his date of birth and the name of the business. I would like to know whether you can help him get back in without the old email. I can send whatever proof you need.',
      },
    ],
    'Security Concern': [
      // grievance (8)
      { text: 'Read marks appear on my private notes that I never opened.', grievance: true },
      { text: 'My export has data from another customer in it. Not okay.', grievance: true },
      {
        text: 'A shared sheet in {product} showed our admin password in plain text to everyone on the team. I have changed it, but I want to know how long it was visible and who looked. I am furious this was possible.',
        grievance: true,
      },
      {
        text: 'A site that looks exactly like your sign-in page asked for my details and I typed them in before I noticed the address was different. I need this dealt with now, I am very worried.',
        grievance: true,
      },
      {
        text: 'My ex-partner knows my passwords and I believe he is reading my projects in {product}. I am scared and I want it stopped.',
        grievance: true,
      },
      {
        text: 'I got a call from a person who knew my {plan} details, my renewal date and the last four digits of my card. They said they were from your fraud team and asked me to read out the code that was texted to me. I did not do it, but how did they get that information? This frightens me, and I want an answer.',
        grievance: true,
      },
      {
        text: 'Last night I plugged a memory stick I found in our car park into my work laptop, which I know was a stupid thing to do. A window flashed, then closed. Since then {product} has asked me to sign in three times, and the cursor sometimes moves by itself. I have disconnected the laptop from the network. I have not told my boss yet. I need to know what you can see on your side and whether any of our files were sent anywhere. I am panicking and I want a real person to tell me what to do next.',
        grievance: true,
      },
      {
        text: 'The browser extension my colleague recommended turned out to copy whatever I type. I found out when it showed my own passwords on a page of its settings. I removed it, but I had been signed in to {product} the whole time. I am angry and I want every session on my profile ended.',
        grievance: true,
      },
      // no flag (8)
      { text: 'How do I report a flaw I found in your website?' },
      { text: 'My API key is on a public page. Disable it please.' },
      {
        text: 'One of our staff typed a password into a page that pretended to be yours, and we have already changed it. What else should we check in {product}?',
      },
      { text: 'The weekly summary email from {product} went to an address at another company, which I do not recognise. Did our data go to them?' },
      {
        text: 'We found that a link to our shared folder was posted in a public forum. I have turned the link off, and I would like to know whether anyone opened it.',
      },
      {
        text: 'Our security team ran a scan and flagged that {product} accepts very short passwords. We tested it with four characters and it worked. For a company of our size, that falls below our policy. Could you tell us whether a minimum length can be enforced for all users?',
      },
      {
        text: 'I lost my hardware security key at the airport yesterday. I use it as my second step for {product}. I have not seen anything odd in my profile, but I want to make sure the lost key cannot be used. How do I cancel it and register a new one?',
      },
      {
        text: 'During our quarterly review I compared the list of people who can see our client folders in {product} with the staff list. Three names were on the first list and not on the second. Two are former interns whose contracts ended last year. The third I cannot identify at all. I have not removed anything yet because I wanted your records of who added them and when. Could you send me the history of those three entries? I also want to know whether any of them opened files in the last ninety days. Our auditors visit next month.',
      },
    ],
    'Accessibility Support': [
      // grievance (8)
      { text: 'Flashing banner on the {product} home page triggers my seizures.', grievance: true },
      { text: 'Hover-only menus in {product} are useless with my head pointer.', grievance: true },
      {
        text: 'Drag and drop is the only way to reorder tasks in {product}, and I cannot do that with my tremor. I have asked for a button before and got no reply.',
        grievance: true,
      },
      {
        text: 'The monthly summary pages in {product} are flat images, so my screen reader says nothing at all. I have to ask my sister to read them to me, which is humiliating.',
        grievance: true,
      },
      {
        text: 'Autoplay video with sound starts on your help page and my screen reader cannot be heard over it. There is no way to stop it quickly.',
        grievance: true,
      },
      {
        text: 'I have a cognitive disability and the wording in {product} is full of long sentences and jargon. The setup wizard asks six things on one screen, and I lose my place every time. I have told your team twice that a plainer mode would help. Both times I received a link to the same dense help page.',
        grievance: true,
      },
      {
        text: 'I operate my computer with a single switch and a scanning cursor. Most screens in {product} take me a few minutes to cross, but I manage. The date picker is the one thing I cannot get past, because it opens as a floating layer that the scanner never reaches. I tried typing the date into the field, and the field rejects everything except what the picker produces. I asked your team for another way to enter dates. They told me to use the picker. A tool I cannot use is not much use to me, and it is why I am writing again.',
        grievance: true,
      },
      {
        text: 'The notification sounds in {product} are the only sign that a message has arrived. I am hard of hearing and I miss them all day. There is no flash, no badge and no vibration option. I have to keep checking by hand, which wastes my time and I find it quite insulting.',
        grievance: true,
      },
      // no flag (8)
      { text: 'Does {product} work with a screen magnifier?' },
      { text: 'Is there a large print version of the welcome guide?' },
      {
        text: 'Our office has a new colleague who is blind. Which parts of {product} are fully usable with a screen reader and which are not?',
      },
      { text: 'Can the text spacing in {product} be increased without things overlapping? I read better with wide lines.' },
      {
        text: 'My reading is easier with a cream background and a certain typeface for dyslexia. Can I set my own colours and fonts in {product}?',
      },
      {
        text: 'I teach a class of adults who are learning to use {product}, and two of them use sign language as their first language. The video lessons only have written captions in English. Would it be possible to get versions with a sign language interpreter, or at least the lesson text in simpler English? I can supply the materials if that helps.',
      },
      {
        text: 'My daughter has cerebral palsy and uses eye tracking to control her computer. She would like to use {product} for school projects. The buttons seem very close together on the screen. Is there a way to make the controls bigger or spaced further apart? We are happy to try any beta setting.',
      },
      {
        text: 'I lost most of my sight three years ago and I am relearning how to use a computer. I work in an office that has been using {product} for a decade. My employer wants me back, and I want to go, but I need to know how I will do my job. I have a screen reader and a braille display. First I need to understand what the layout is, then which shortcuts exist, then whether the charts have text versions. Is there a person on your side who knows these things well? I would gladly have a short call with them. I only want to know where to start.',
      },
    ],
    'Product Question': [
      // grievance (4)
      { text: 'Why does the help page contradict the pricing page about {feature}?', grievance: true },
      {
        text: 'The {plan} was sold to us as having {feature}. After buying it, I cannot find it anywhere, and nobody will tell me whether it exists.',
        grievance: true,
      },
      {
        text: 'We chose your product after a demo where the salesperson showed us scheduled reports. Now that we are using it, it turns out that feature is only in the {otherPlan}. Nobody mentioned this during the demo. I would like a straight answer about which of the things shown are part of the {plan}.',
        grievance: true,
      },
      {
        text: 'We are about to budget next year around one number and I cannot pin it down: how many projects can we create in the {plan}? The pricing page says ten. The in-app help says twenty. A banner inside {product} says unlimited. It is maddening when a whole budget hangs on it. My boss now thinks I am the one who is confused. Which figure is the real limit, and where is it written down?',
        grievance: true,
      },
      // no flag (12)
      { text: 'Is there a limit on file size in {product}?' },
      { text: 'Which languages does {product} support?' },
      { text: 'Does {product} work without internet for a few hours?' },
      { text: 'Where are my files stored in {product}? We have a rule that data must stay inside the country.' },
      { text: 'How long does {product} keep the version history of a document? We sometimes need to go back a year.' },
      {
        text: 'Can I set different permissions for viewers, editors and owners in {product}? We have outside partners who should only read.',
      },
      { text: 'Is there a discount for non-profit groups on the {plan}? We are a small charity with six staff.' },
      { text: 'Does the {plan} work with shared calendars so that deadlines show up for everyone?' },
      {
        text: 'Can I import about 30000 rows of contacts at once? Or is there a cap per upload? I would like to arrange the work in batches if there is one.',
      },
      {
        text: 'We are evaluating {product} for a team of about 60 people spread across three time zones. I would like to know how you handle uptime, and whether there is a written promise about it. Is there a status page where we can see past problems? Our procurement process asks for these answers.',
      },
      {
        text: 'I am new to {product} and trying to understand the difference between a project, a folder and a workspace. The help page uses all three words and I am confused. Could you tell me, in a couple of lines, how they relate? An example would be great.',
      },
      {
        text: 'My nonprofit is thinking of moving from spreadsheets to {product}. We have about eight volunteers, and only two of them are comfortable with software. Each volunteer works a few hours a week. We keep a list of donors, a list of events, and a list of rooms we borrow. I wonder whether {product} can handle all three kinds of list or only one. I also wonder if the {plan} is meant for a team like ours. If you have a case study or a short guide, I would like to read it. I do not need a call, just a pointer.',
      },
    ],
    'Urgent Complaint': [
      { text: 'Nobody there owns a problem past the first reply.', grievance: true },
      { text: 'Your chat bot loops and no human ever joins.', grievance: true },
      { text: 'Rude agent today. I want it recorded.', grievance: true },
      { text: 'Four weeks of silence is not support.', grievance: true },
      {
        text: 'The agent I spoke to blamed me for the whole thing and then hung up when I disagreed. I want that conversation reviewed.',
        grievance: true,
      },
      {
        text: 'I have no ticket number, no name, and no record of what was said on Monday. How is anyone meant to follow up on that?',
        grievance: true,
      },
      {
        text: 'Your team told me a supervisor would look at my case within two days. It has been {days} days and nobody has even confirmed that it exists.',
        grievance: true,
      },
      {
        text: 'Every time I write, someone new answers and starts from zero. I am tired of being the only person who remembers my own case.',
        grievance: true,
      },
      {
        text: 'I got a reply that answered a different question from the one I asked, signed by someone who clearly did not read my message.',
        grievance: true,
      },
      {
        text: 'After being on hold for 50 minutes the line cut off. When I called back, I was in the queue behind everybody else again.',
        grievance: true,
      },
      {
        text: 'I have held an annual contract for five years, and this is the first time I have had to chase anyone for anything. Three people have said they would handle it. None of them has sent me a single update. I would like the courtesy of a proper reply from someone with the authority to decide.',
        grievance: true,
      },
      {
        text: 'When I first wrote in, the response was quick and friendly. Then I replied with more detail and the whole thing went dead. Two weeks on, I still have no answer. I would like to know whether my case was lost, and who is looking at it today.',
        grievance: true,
      },
      {
        text: 'You changed the rules on how support works without telling anyone. I found out when my request was refused because I was on the wrong tier. A message beforehand would have taken one minute. It left me feeling like a number, and I do not think that is too much to say.',
        grievance: true,
      },
      {
        text: 'I arranged for my whole team to take training from your company. The trainer did not show up and nobody had told us. We lost a half day of work for twelve people. I want a call from someone senior and an explanation, not a form.',
        grievance: true,
      },
      {
        text: 'I want to describe what has happened over the last month, because I do not think anyone at your company has seen the whole picture. On the first of the month I reported a problem and was given a case number. A week later I was told the case had been merged with another one, and I should disregard the old number. After that I was passed to a different team, who asked for the same details again. They then said that the first team should handle it. I have now spoken to five people and written eleven messages. Not one person has told me what is happening or when it will end. Please put someone in charge of my case who will actually own it.',
        grievance: true,
      },
      {
        text: 'I was a happy customer until this week. On Monday a colleague of yours promised in writing to call me by noon. At three I wrote to ask what had happened and nobody replied. On Tuesday morning I was told by another person that the first person had gone on leave. They did not know about the promise. They said they would find out and come back to me that afternoon. It is now Thursday and I have heard nothing from either. I would like to be told plainly whether this is how you work.',
        grievance: true,
      },
    ],
    'Shipping/Order Issue': [
      // statusQuestion (4)
      { text: 'When will my order arrive? Just checking.', statusQuestion: true },
      {
        text: 'I ordered on {date} and the website says "label created". Does that mean it has left the warehouse yet?',
        statusQuestion: true,
      },
      {
        text: 'My order was meant to be here by {date}, though I know holidays can slow things. I just want to know which depot it is at now. There is no rush, I only need to decide whether to stay home. Is there a way to see more than the "in transit" line?',
        statusQuestion: true,
      },
      {
        text: 'I ordered a birthday gift for my niece, who lives in another city, and I chose the standard delivery. The checkout said five to seven working days. It is day six and the tracking page shows one entry from the day I ordered. I am not worried yet, since I know these pages can lag. Still, I would like to know whether I should expect it tomorrow or next week. If it is going to be late, I will buy something small locally and give her the parcel afterwards. Could someone tell me where it is, roughly?',
        statusQuestion: true,
      },
      // grievance (4)
      { text: 'Package arrived soaked and the item is ruined.', grievance: true },
      {
        text: 'The box was open and taped shut again, and a cable that should be in it is missing. This is the second time something has gone wrong with a delivery from you.',
        grievance: true,
      },
      {
        text: 'My order showed as delivered on {date}, but the photo of the delivery spot is of a doorway that is not mine. I have asked my neighbours and checked the bins. The courier company says it is your problem and you say it is theirs. I just want my item.',
        grievance: true,
      },
      {
        text: 'I waited in all day for a delivery that had a time window of 9 to 1. At two o clock I checked the tracking and it said "attempted, no one home". I was home the whole time and my phone was next to me. No knock, no call, no card through the door. I phoned the courier and they said they could rebook for next week. I have already taken a day off for this once. I want it delivered at a time I can actually count on, and I want someone to look at why the driver marked it that way.',
        grievance: true,
      },
      // no flag (8)
      { text: 'Do you deliver on Saturdays?' },
      { text: 'Can I split one order into two deliveries?' },
      {
        text: 'I would like to leave a safe-place note for the driver: behind the green bin at the side gate. Where do I enter that?',
      },
      { text: 'The item in my order has a name different from the one on the packing slip. Is it the same product?' },
      { text: 'I need to send back a faulty lamp and I live on a farm with no courier pickup. What are my options?' },
      { text: 'My delivery window is the same day as a public holiday in my country. Will your couriers still come?' },
      {
        text: 'I live in a flat with a shared entrance, and the couriers often cannot get in. Could I give a code for the door? Or should I give the number of the building manager instead? Either would work for me.',
      },
      {
        text: 'I ordered for a wedding on {date} and the items are in two separate boxes with two separate tracking numbers. Is that normal? If one arrives a day late I will have trouble. Is it possible to ask for them to be sent together?',
      },
    ],
    Other: [
      // grievance (4)
      { text: 'Stop sending paper mail to my old house.', grievance: true },
      {
        text: 'I got a printed brochure addressed to a person who has not lived here for years. It has come four times and I have returned it every time.',
        grievance: true,
      },
      {
        text: 'Your company sponsored the local football club, and now the stadium has your banner covering the notice board for our community group. We asked the club to move it and they said to ask you. Our events are being missed because of it. Who can I speak to about getting it moved?',
        grievance: true,
      },
      {
        text: 'I run a small shop on the same street as your regional office. Your trucks have been parking in the lane behind my shop every morning for about a month. Customers cannot park and I have lost sales. I have spoken to the drivers and they say they have nowhere else to stop. I wrote to the address on your website and the letter came back unopened. I am not trying to cause trouble. I would simply like to speak to whoever arranges the schedule, so that we can find a time that works for us both.',
        grievance: true,
      },
      // no flag (12)
      { text: 'Who do I address a formal letter to at your company?' },
      { text: 'Can you verify that my cousin worked for you?' },
      { text: 'Do you offer internships for high school students?' },
      {
        text: 'I am a graduate student surveying small software firms for my thesis. Would someone be willing to answer ten questions by email?',
      },
      { text: 'We found a box of your branded mugs at a charity shop. Do you want them back, or shall we pass them on?' },
      { text: 'I would like to donate ten old laptops to a school and wondered if your company runs any scheme for that.' },
      {
        text: 'A caller dialled my home number by mistake asking for your sales office, and it has happened three times this month. Is your number printed wrongly somewhere?',
      },
      { text: 'Can I book a speaker from your company for a careers day at our college in the autumn? We would cover travel.' },
      {
        text: 'My father worked for your firm for nearly thirty years before he retired in the nineties. We are putting together a family album and would love any old photos or newsletters you might have. Is there an archive we could write to?',
      },
      {
        text: 'Our village hall is holding an open evening for local businesses. We have a table free. Would someone from your office like to come and talk about what you do? It is on the first Friday of next month.',
      },
      {
        text: 'We make stickers and cards and we think your staff might like a custom set for the holidays. Could you tell me who in your company buys gifts for staff? I would like to send a sample and a catalogue.',
      },
      {
        text: 'I am writing a history of small software firms in this region and your company was founded about twenty years ago. I have read the short story on your website, but I would like to know more. How did the first office look? Who were the first staff? Were there any products that never reached the market? I realise this is not a usual request, so I am happy to wait for a reply. If someone who has been there a long time would like to chat, I can visit, or we can talk by phone. I would credit you in the book.',
      },
    ],
  },
  trapTemplates: {
    Billing: [
      { text: 'Our accountant needs the {plan} invoice with the tax number printed on it. Can you resend it?' },
      { text: 'The invoice for the {plan} arrived with the wrong name, which looks like a typo from the Canada office address. Can you reissue it?' },
      { text: 'There is a bug in how the {plan} total is displayed on my invoice: it shows {amount} but the email says a different figure.' },
      { text: 'Please move the {plan} bill from my personal card to the company account, starting with the next renewal on {date}.' },
      { text: 'Our Nevada office pays by purchase order. Please send a quote for {amount} in the form our finance team requires.' },
      { text: 'Adam in our accounts payable team says the {plan} invoice number repeats on two different bills. Which one is correct?' },
      { text: 'My finance system debug log shows the {plan} invoice file uses a date format it cannot read. Could you send it as plain text?' },
      { text: 'Is it possible to receive one combined invoice per quarter for the {plan} rather than twelve small ones? Our accounting department would prefer that.' },
    ],
    'Technical Issue': [
      { text: 'The sync in {product} stops whenever my laptop is on its charger, but it works on battery.' },
      { text: 'Charts in {product} show blank for our Nevada office team, though they render for everyone else.' },
      { text: 'The accounting module in {product} freezes whenever I scroll past row 500.' },
      { text: 'The video adapter in my laptop is fine, but {product} draws the map as a black rectangle.' },
      { text: 'Copy and paste in {product} drops the second line, which breaks the notes I keep for each account.' },
      { text: 'My phone charges slowly while {product} is syncing in the background, and the app then freezes.' },
      { text: 'The preview pane in {product} is blank for the files our Granada team sends over, and the same files open fine on my laptop.' },
      { text: 'The chat bubble in {product} flickers each time a new message arrives, and the account switcher flickers with it.' },
    ],
    'Account Access': [
      { text: 'The sign-in code for {product} arrives after it has already expired when I am in Canada.' },
      { text: 'There is a bug with the remember me box in {product}: it forgets me every night and I have to reset my password daily.' },
      { text: 'The adaptive sign-in check in {product} keeps asking me to prove it is me, then rejects my answer.' },
      { text: 'I am locked out of {product} and the helpdesk page says no charge for unlocking, but the unlock form does not load.' },
      { text: 'I tried to sign in to {product} from my Nevada hotel and the site says my location is not allowed.' },
      { text: 'The debug mode of my browser was on when I signed in to {product}, and now I cannot get past the verification step.' },
      { text: 'My laptop was on charge overnight, and in the morning {product} asked for a code I do not have any more.' },
      { text: 'My colleague Adam asked me to hand over my seat in {product}, but the sign-in tells him that the email is already in use.' },
    ],
    'Security Concern': [
      { text: 'A site pretending to be an accounting tool asked me to sign in with my {product} details. I did not, but I want you to know.' },
      { text: 'Someone in Canada tried to sign in to my {product} three times last night, and none of them was me.' },
      { text: 'A bug bounty hunter messaged me claiming a flaw in {product} and asked for money to explain it. Is this normal?' },
      { text: 'My card details were used for a charge in another country right after I entered them in a form on a site that looked like yours.' },
      { text: 'The access token for our API was pasted into a public chat by mistake. I have not rotated it yet. How do I disable it?' },
      { text: 'An email with an attachment named "invoice.zip" claims to come from your accounts team. I have not opened it.' },
      { text: 'A bugged browser add-on I installed by mistake kept sending my {product} cookies to an unknown site. I removed it.' },
      { text: 'Our Nevada branch laptop was left unlocked in a cafe for ten minutes with {product} open.' },
    ],
    'Accessibility Support': [
      { text: 'The sign-up form has no labels for my screen reader, so I cannot tell which field is the account name.' },
      { text: 'A bug in the {product} sidebar makes it jump focus to the top every time I press tab, which is hard with my motor tremor.' },
      { text: 'The charge summary page in {product} shows amounts only in colour, red or green, and I cannot tell them apart.' },
      { text: 'Is access to {product} possible with eye tracking? My hands do not work well.' },
      { text: 'The account settings page in {product} has tiny tick boxes that I cannot hit with a head pointer.' },
      { text: 'When I turn on large text, the access menu in {product} overlaps the page and hides the buttons.' },
      { text: 'The debug panel in {product} reads out raw code to my screen reader every time a page loads.' },
      { text: 'The on-screen keyboard in {product} covers the field I am typing in, and I need access to a bigger layout for my low vision.' },
    ],
    'Product Question': [
      { text: 'Does the {plan} give access to {feature}, or only the {otherPlan}?' },
      { text: 'Which public roadmap do you use to decide which bugs are fixed first?' },
      { text: 'Can the {plan} be shared across a Canada branch and a head office under one contract?' },
      { text: 'Is there a flat charge for extra storage in {product}, or does it go by usage?' },
      { text: 'Can an accountant outside our firm be given view-only rights in {product}?' },
      { text: 'Does {product} have an adaptive layout so it works on a phone as well as a desktop screen?' },
      { text: 'How many accounts can be linked together under the {plan}? We have four companies.' },
      { text: 'Does {product} have a debug or test mode where I can try {feature} on sample data first?' },
    ],
    'Urgent Complaint': [
      { text: 'Your account team promised me a plan in writing and then ghosted me for three weeks. I am done with this.' },
      { text: 'Adam from your team gave me three different answers in one call and then said it was not his job. This is unacceptable.' },
      { text: 'Your Nevada office keeps passing me to a call centre that has no authority, and I have had enough.' },
      { text: 'I do not care about the bug. I care that nobody told me for a month, and then a junior person shrugged at me.' },
      { text: 'The way your company handles complaints is a disgrace: my account has been escalated twice and each time it went to a mailbox no one reads.' },
      { text: 'I have recharged my phone twice waiting on hold for your team, and each time the line dropped.' },
      { text: 'The adaptable policy your agent quoted me does not exist anywhere in your documents, and I am angry about being told it does.' },
      { text: 'I find it insulting that a bug in your own system caused this and your agent still treated me like the problem.' },
    ],
    'Shipping/Order Issue': [
      { text: 'The adapter I ordered came with a plug for the wrong country, so it does not fit my sockets.' },
      { text: 'My order is stuck in Canada and the tracking page has said "held" for {days} days.' },
      { text: 'The parcel for my order arrived for Adam, who lives two doors down and is not me, yet it has my name on it.' },
      { text: 'I was charged delivery for an item that came in two parcels, and one of them is still missing.' },
      { text: 'The courier needs access to our building lobby, which is locked, and my parcel is sitting outside.' },
      { text: 'My accountant ordered a printer for our office and the box arrived with the lid torn open.' },
      { text: 'The Nevada warehouse sent my order to my old address, and the parcel is on its way back.' },
      { text: 'My order of a debug probe for work arrived with the cable missing from the box.' },
    ],
    Other: [
      { text: 'Our accounting students would like to write a case study on your hiring approach. Who can answer a few questions?' },
      { text: 'We make travel adapters and would like to send your team a free sample. Which address should it go to?' },
      { text: 'I write a newsletter about bugs and beetles for children and wondered if your office would like a free subscription.' },
      { text: 'Could you tell me the charge for hiring your meeting room for a community event on {date}?' },
      { text: 'I am the new accounts clerk at the supplier next door and wanted to say hello to your office.' },
      { text: 'A stray cat has been sitting in your car park access road for two days. Is somebody able to check on it?' },
      { text: 'The Granada office of our charity would like to send your team a postcard from our trip. Who should it be addressed to?' },
      { text: 'Is your front access door open to visitors, or only to staff? I would like to deliver a handwritten note.' },
    ],
  },
  vagueTemplates: [
    { text: 'It is happening again and I do not know who else to tell.' },
    { text: 'My colleague showed me something odd on the screen yesterday and now I am not sure what to do.' },
    { text: 'Can you look into the thing from last Tuesday? I think you know the one.' },
    { text: 'I tried everything in the guide and nothing changed. Please get in touch.' },
    { text: 'The screen went funny for a moment and then it went back, but I worry about it.' },
    { text: 'Tried it the way the note said and it still comes out the wrong way round.' },
    { text: 'I am not technical so forgive the vague message, but the usual way does not go anymore.' },
    { text: 'Something changed on its own while I was away and I would like it put back.' },
    { text: 'My team keeps asking me about it and I have no idea what to say to them.' },
    { text: 'Was there a change on your side recently? Things feel different to me.' },
    { text: 'I need to speak to somebody about what happened. It is not urgent but it is bothering me.' },
    { text: 'A message popped up and I clicked the wrong thing, and now I am not sure whether I should be worried.' },
  ],
  politeSecurityTemplates: [
    { text: 'I noticed that the list of people who can see my shared notebook now has a name I have never seen, and I did not add them.' },
    { text: 'A message with my sign-in code came by text at 3 in the morning, and nobody in my house had asked for it.' },
    { text: 'My {product} profile shows a new backup phone number that I did not enter.' },
    { text: 'The sign-in history of {product} lists a browser I have never used, on a computer system I do not own.' },
    { text: 'I was sent an email with a link to a page that looks like yours, and it asked me for my password. I did not enter it.' },
    { text: 'A few of my saved files in {product} were opened at an hour when I was asleep, and the activity list shows a device that is not mine.' },
    { text: 'A caller from outside phoned my office pretending to be from your company and wanted my login code, which I did not give.' },
    { text: 'My laptop was left on a train for an hour and came back with {product} still open, so somebody may have read my files.' },
    { text: 'The webhook address for my {product} integration appears in a public post on a forum, and I think people could send fake data to it.' },
    { text: 'My two-step codes stopped working today and my sign-in list shows a new phone that I did not set up.' },
    { text: 'I received a notice that my password was changed an hour ago, and I did not change it.' },
    { text: 'A share link to my private folder in {product} was opened from two countries within a few minutes, and I only sent it to one person.' },
  ],
  threatPhrases: [
    'I will file a complaint with the consumer protection authority tomorrow morning if this stays as it is.',
    'My lawyer has been given a copy of this message and will send you a letter by the end of the week.',
    'If this is not put right today, I will report your company to the regulator.',
    'I will publish the whole story, with every message you sent me, on social media tonight.',
    'Expect a formal legal notice at your head office within days unless I get a proper answer.',
    'I am going to the small claims court, and I will bring all of my records with me.',
    'The trade press will have this by Monday if nobody calls me, and I am not bluffing.',
    'I will submit a formal complaint to the data protection office and the consumer ombudsman next.',
    'I have already written a review of this whole experience, and I will post it everywhere tonight if you do not respond.',
    'My company will tell its lawyers to look at our contract, and we will tell other firms in our sector about this.',
    'Unless this is solved by Friday, I will take it to a tribunal and to a newspaper.',
    'I am recording every call from now on, and the recordings will go to a regulator and to the press.',
  ],
  twoIssueConnectors: [
    'Before I forget.',
    'Adding to that.',
    'In a different area.',
    'By the way.',
    'There is one more matter.',
    'Turning to something else.',
    'Apart from that.',
    'A second point.',
    'On top of that.',
    'Changing the subject.',
    'Last point.',
    'Separately from this.',
  ],
  openers: OPENERS,
  closers: CLOSERS,
  requests: REQUESTS,
};
