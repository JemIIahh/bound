# Fraud case research for Bound pitch (researched 2026-09-30)

Labels: [P] = I opened the primary source (DOJ / SEC / Interpol / FBI / police / company release) and read it. [S] = secondary (news, vendor blog, or a search-result snippet only). UNVERIFIED = could not confirm.

Method note: WebSearch was capped, so I used Google/Wikipedia in a browser only to find URLs, then opened the primary pages. Interpol dates are as shown on interpol.int.

---------------------------------------------------------------------
## 1. Ramon Olorunwa Abbas ("Ray Hushpuppi")
---------------------------------------------------------------------

### 1.1 Timeline and outcome [P]
- 2020-06: arrested by UAE authorities in Dubai. DOJ says he was "expelled from the UAE" and arrived in Chicago on Thu 2020-07-02 (FBI took custody). DOJ press release dated 2020-07-03 says "expelled", NOT "extradited". Complaint filed 2020-06-25 (C.D. Cal., 2:20-cr-00322-ODW).
  Source [P]: https://www.justice.gov/usao-cdca/pr/nigerian-national-brought-us-face-charges-conspiring-launder-hundreds-millions-dollars
- 2021-04-20: pleaded guilty to ONE count of conspiracy to engage in money laundering (unsealed 2021-07-26/27; plea agreement filed 2021-07-27).
  Sources [P]: https://www.justice.gov/usao-cdca/pr/six-indicted-international-scheme-defraud-qatari-school-founder-and-then-launder-over-1 ; plea agreement PDF (UNODC copy of Doc. 46): https://www.unodc.org/cld/uploads/res/case-law-doc/cybercrimecrimetype/usa/2021/united_states_of_america_v__abbas_no__220-cr-00322-odw_c_d__cal__jul__27_2021_html/United_States_of_America_v._Abbas_No._220-CR-00322-ODW_Redacted_Plea_Agreement_C.D._Cal._Jul._27_2021.pdf
- 2022-11-07: sentenced by Judge Otis D. Wright II to 135 months (11 years 3 months); restitution $1,732,841 = $922,857 (New York law firm) + $809,983 (Qatari businessperson). Age 40 at sentencing. He was a 37-year-old at arrest.
  Source [P]: https://www.justice.gov/usao-cdca/pr/nigerian-man-sentenced-over-11-years-federal-prison-conspiring-launder-tens-millions (Press Release 22-233)
- FBI investigation name: "Operation Top Dog". Dubai Police assisted.

### 1.2 What he actually did: a money launderer / account provider, not the email hacker
DOJ affidavit language (2020-07-03): he was "one of the leaders of a transnational network that facilitates computer intrusions, fraudulent schemes (including BEC schemes), and money laundering". The plea agreement says he "would sometimes communicate with fraudsters, or middle-men for fraudsters, who sought bank accounts into which they could fraudulently induce victims to deposit or transfer funds", then coordinated moving and laundering the money (international wires, checks/cash withdrawals). [P]

Confirmed amounts in the plea agreement (actual or intended loss he admitted, p.17): [P]
| Scheme | Amount | Nature |
|---|---|---|
| Foreign financial institution (bank in Malta) | ~$14,700,000 (EUR 13,000,000) | SWIFT bank cyber-heist, intended loss; Jan/Feb 2019; DOJ says the US charged North Korean hackers for the heist |
| Two victim companies in the UK | ~$7,740,000 | BEC; he and co-conspirator discussed 2019-05-12 "approximately GBP 6 million per week" of anticipated fraudulent payments |
| New York law firm | $922,857.76 | BEC, Oct 2019 |
| Qatari businessperson / school company | $809,983.58 | advance-fee "loan" fraud (not BEC) |
| Sum of the four | roughly $24.2 million | matches DOJ's "cumulatively caused more than $24 million in losses" (2021-07-28 release) |

### 1.3 Named schemes, step by step
**(a) New York law firm, Oct 2019, $922,857 [P]** (complaint affidavit, 2020-07-03 release; plea agreement)
1. Abbas and co-conspirators targeted a client of a New York law firm who was refinancing real estate.
2. They "tricked one of the law firm's paralegals into wiring money intended for the client's real estate refinancing to a bank account that was controlled by Abbas and the co-conspirators". (The moment of redirection: the wire went to an account they controlled, not the client's real lender/escrow.) The 2022 release says the law firm was "fraudulently induced ... to transfer approximately $922,857 to an account that a co-conspirator controlled under someone else's name."
3. Laundering: per plea agreement, he conspired with Ghaleb Alaumary to use a CIBC account held in Ontario, Canada by another person ("UICC 2") to launder the law-firm funds.
4. Restitution ordered: $922,857.
NOTE: DOJ says the paralegal was tricked; DOJ does not (in the pages I read) describe the exact email spoofing technique. Do not invent "spoofed domain" details for this case.

**(b) Qatari school-loan scheme, 2019-2020 [P]** (indictment release 2021-07-28; plea; sentencing release)
1. Victim: a Qatari businessperson trying to finance a school, seeking a $15M loan.
2. Co-conspirators posed as consultants/bankers; Abbas played "Malik", a Wells Fargo banker in New York; a co-conspirator (Kelly Chibuzo Vincent, Nigeria) created bogus documents, a fake bank website and a phone banking line.
3. Victim paid ~$330,000 to fund an "investor's account": Abbas directed $100,000 to a co-conspirator's bank account and $230,000 to a luxury watch seller. He bought a $230,000 Richard Mille RM11-03 watch delivered to him in Dubai.
4. Jan-Feb 2020: tried to extract a further $575,000 "taxes"; victim sent ~$299,983 to Kenyan accounts (Feb 2020) and ~$180,000 to US accounts (Mar 2020).
5. ~$50,000 of proceeds bought St Kitts and Nevis citizenship/passport via a sham marriage and bribed official.
6. DOJ headline number in indictment release: "more than $1.1 million" stolen from the Qatari victim. Restitution ordered: $809,983.
7. Dispute among conspirators: Abbas allegedly arranged (through Abba Alhaji Kyari, a Nigerian police deputy commissioner) to have co-conspirator Vincent jailed in Nigeria. (Allegation in affidavit; Kyari was not a defendant in this plea.)
This is an advance-fee/impersonation scam, NOT payment-detail redirection. Do not call it BEC.

**(c) English Premier League club, May 2019 [P, but only as allegation/intent]**
- The 2020-07-03 complaint release says Abbas and others "conspired to launder hundreds of millions of dollars ... including one scheme to steal GBP 100 million (approximately $124 million) from an English Premier League soccer club". That was a complaint allegation (an attempt).
- The 2022 sentencing release says only "millions of pounds stolen from a professional soccer club in the United Kingdom as well as a British company" and that he gave Alaumary details for a Mexican bank account that "could handle millions and not block".
- Plea agreement loss figure for both UK companies together: ~$7.74M. The club is never named by DOJ. Do not name it.
- Alaumary's 2021 release lists "a professional soccer club in the United Kingdom" among his victims.

**(d) Maltese bank cyber-heist, Feb 2019, $14.7M [P]** – Bank Malta funds: Abbas provided account details for banks in Romania and Bulgaria (2022 release); complaint says two European accounts each anticipated to receive EUR 5M. He admitted intended loss of ~$14.7M. DOJ links the heist to North Korean hackers (they were charged separately). Note: this was a hack of the bank's SWIFT system, not invoice redirection.

**(e) "$300 million"** – prosecutors' sentencing memorandum: "by his own admission, during just an 18-month period defendant conspired to launder over $300 million... much of this intended loss did not ultimately materialize" [P]. This is intended/attempted laundering volume, not money actually stolen.

### 1.4 Co-conspirators and laundering [P]
- Ghaleb Alaumary (Mississauga, Canada, dual Canada/US citizen): sentenced 2021-09-08 (S.D. Ga.) to 140 months, >$30M restitution. Provided accounts, recruited ATM cash-out crews, laundered via wires, cash and crypto. Included the Malta heist, BankIslami (Pakistan) ATM cash-out, a Canadian university BEC (see 2.6). Source [P]: https://www.justice.gov/usao-cdca/pr/international-money-launderer-sentenced-over-11-years-federal-prison-laundering (Note: the 2022 Abbas release says Alaumary "is serving a 140-month sentence"; the DOJ 2021 release confirms.)
- Qatari case: Abdulrahman Imraan Juma (Kenya), Kelly Chibuzo Vincent (Nigeria), Yusuf Adekinka Anifowoshe (Brooklyn), Rukayat Fashola (Valley Stream NY), Bolatito Agbabiaka (Linden NJ), Kyari (Nigerian police official). Launder methods: cashier's checks, bank accounts in multiple countries, luxury goods. [P] 2021-07-28 release.
- Laundering model in his network: obtain accounts (often in third-party names or business-name lookalikes) that can receive large sums without being blocked; move funds by international wire, withdraw as cash/cheques, buy luxury goods.

### 1.5 Corrections to common claims about Hushpuppi
- He was "expelled" from the UAE to the US; DOJ uses "expelled". "Extradited" is widely used in media but is not DOJ's word.
- Sentence is 135 months (11 years 3 months), restitution $1.73M. Not "$435M" or "$1 billion".
- He pleaded to one money-laundering conspiracy count, not to hacking or to personally sending BEC emails.
- The Qatari deal was a fake loan, not BEC.
- "He stole $124M from an EPL club": it was an alleged attempt (complaint); nothing in the plea confirms that amount was taken.
- (Wikipedia was used only to find the DOJ URLs.)

---------------------------------------------------------------------
## 2. Other major BEC / invoice-redirection cases and operations
---------------------------------------------------------------------

### 2.1 Evaldas Rimasauskas (fake supplier invoices) [P]
- Who: Lithuanian citizen. Arrested in Lithuania March 2017; extradited to SDNY Aug 2017; pleaded guilty to one count of wire fraud (2019-03-20); sentenced 2019-12-19 to 60 months, forfeiture $49,738,559.41, restitution $26,479,079.24.
- Method (DOJ, verbatim substance): he registered a Latvian company ("Company-2") with the same name as an Asian computer-hardware manufacturer ("Company-1"), opened bank accounts in Latvia and Cyprus in that name; phishing emails sent to employees of two US internet companies that regularly paid Company-1 told them to send money owed to Company-1 to Company-2's accounts. Emails appeared to come from Company-1 employees. Funds were then moved quickly to accounts in Latvia, Cyprus, Slovakia, Lithuania, Hungary and Hong Kong; forged invoices, contracts and letters with fake corporate stamps were sent to banks to justify the large wires.
- Amount: "over $120 million" total (2013-2015); DOJ 2017/2019 headline "over $100 million" at plea.
- Moment payment details changed: the emails that told the victims to pay Company-2's accounts instead of Company-1's.
- Source [P]: https://www.justice.gov/usao-sdny/pr/lithuanian-man-sentenced-5-years-prison-theft-over-120-million-fraudulent-business
- DOJ does not name the victim companies or Company-1. Google and Facebook (victims) and Quanta Computer (impersonated) come from press (Fortune 2019 etc.); I saw only a Sophos search snippet naming "Google and Facebook" and did not open a news article. Label: naming = [S]. Also: restitution was only ~$26.5M, and reports say Google and Facebook recovered most of the money. Say "over $100 million was wired", not "he kept $100M".
- Also Facebook/Google were reportedly repaid; do not say they "lost $100M".

### 2.2 Obinwanne Okeke ("Invictus") [P]
- Who: Nigerian, ran the Invictus Group; sentenced 2021-02-16 (E.D. Va.) to 10 years. Age 33. Pleaded guilty 2020 (plea release exists at the EDVA site; I opened only the sentencing release).
- Method: April 2018 a Unatrac Holding Ltd (Caterpillar's export sales office) executive fell for a phishing email that captured login credentials; conspirators then sent fraudulent wire transfer requests with fake invoices. Nearly $11 million transferred overseas.
- Also: 2015-2019 credential harvesting of hundreds of victims, fake web pages.
- Amount: "approximately $11 million in known losses" (Unatrac "nearly $11 million").
- Source [P]: https://www.justice.gov/usao-edva/pr/nigerian-national-sentenced-prison-11-million-global-fraud-scheme
- Nuance: the sentencing release calls Unatrac "the export sales office for Caterpillar" and does not say "Caterpillar dealer". Forbes 30-under-30 Africa link is from media, not DOJ (not verified here).

### 2.3 Ubiquiti Networks, 2015 [P]
- SEC Form 8-K filed 2015-08-06: on 2015-06-05 the company determined it was the victim of a criminal fraud involving "employee impersonation and fraudulent requests from an outside entity targeting the Company's finance department", resulting in $46.7 million of transfers out of a Hong Kong subsidiary to overseas accounts held by third parties. Recovered $8.1M; $6.8M frozen; $31.8M still being pursued at the time.
- Source [P]: https://www.sec.gov/Archives/edgar/data/1511737/000157104915006288/t1501817_8k.htm
- Note: the 8-K does not say the payee details were "changed" in an invoice; it says impersonation of employees and an outside entity making fraudulent requests. Use "impersonation of executives and outside parties", not "changed bank details".

### 2.4 Toyota Boshoku Europe, Aug 2019 [P for the amount, no method]
- Company news release 2019-09-06: fraudulent payment directions from a "malicious third party" caused a loss at the European subsidiary; incident date 14 August 2019; expected loss "Approximately 4 billion yen maximum" (about $37M in press).
- Source [P]: https://www.toyota-boshoku.com/global/news/_assets/upload/190906e-1.pdf
- The company gave NO further details. Media (Tripwire, Forbes) say ~$37M and call it BEC; the claim that a supplier's bank details were changed is the commentators' generic BEC description (Tripwire), not from Toyota Boshoku. Label method: UNVERIFIED. Use only "fraudulent payment directions", ~4bn yen.

### 2.5 Interpol / FBI operations against West African BEC networks
- **Operation reWired (US DOJ, announced 2019-09-10) [P]:** 281 arrests worldwide over four months (May-Sept 2019), including 167 in Nigeria, 18 in Turkey, 15 in Ghana; 74 in the US; ~$3.7M seized. IC3 reported "nearly $1.3 billion" BEC/EAC losses in 2018. It describes BEC as intended to "intercept and hijack wire transfers", and money mules. Source: https://www.justice.gov/archives/opa/pr/281-arrested-worldwide-coordinated-international-enforcement-operation-targeting-hundreds
- **Operation Wire Wire (June 2018)** [P via the reWired release]: 74 arrests, ~$2.4M seized, ~$14M in fraudulent wires disrupted/recovered.
- **Operation Falcon (Interpol, 2020-11-25) [P]:** 3 Nigerians arrested in Lagos with Group-IB; gang accused of malware, phishing and BEC; compromised government/private firms in >150 countries since 2017; ~50,000 targeted victims identified. https://www.interpol.int/en/News-and-Events/News/2020/Three-arrested-as-INTERPOL-Group-IB-and-the-Nigeria-Police-Force-disrupt-prolific-cybercrime-group
- **Operation Falcon II (Interpol, 2022-01-19) [P]:** 11 arrests in Nigeria (13-22 Dec 2021), suspects linked to "SilverTerrier" BEC network; possibly >50,000 targets; one suspect held >800,000 victim domain credentials; another monitored conversations between 16 companies and clients and diverted funds to SilverTerrier "whenever company transactions were about to be made". https://www.interpol.int/en/News-and-Events/News/2022/Nigerian-cybercrime-fraud-11-suspects-arrested-syndicate-busted
- **Operation Jackal III (Interpol, 2024-07-16) [P]:** 10 Apr-3 Jul 2024, 21 countries, ~300 arrests, >400 more suspects identified, >720 bank accounts blocked, $3M assets seized; targets Black Axe and other West African groups; Argentina case: 72 arrests, $1.2M "supernotes", ~100 accounts frozen, >160 fraud victims; Portugal: Nigerian money-mule network. Indonesia was a participating country. https://www.interpol.int/en/News-and-Events/News/2024/INTERPOL-operation-strikes-major-blow-against-West-African-financial-crime
- **Operation Jackal IV (Interpol, 2026-08-25) [P]:** Nov 2025-Jun 2026, 23 countries, 58 arrests (39 in South Africa), 263 suspects identified; Interpol says these groups are responsible for a share of cyber-enabled fraud "through romance scams, cryptocurrency and investment scams or business email compromise fraud". Indonesia participating. https://www.interpol.int/en/News-and-Events/News/2026/58-arrests-in-global-effort-to-dismantle-West-African-organized-crime-groups
- **Black Axe:** Interpol describes it (Jackal III) as "one of the most prominent West African transnational organized crime syndicates, with operations in cyber fraud, human trafficking, drug smuggling, and violent crimes". Do not describe Black Axe as purely a BEC group.
- **C.D. Cal. 80-defendant indictment (2019-08-22) [P]:** 252 counts, 80 defendants, mostly Nigerian, BEC + romance scams; brokers (Valentine Iro, Chukwudi Igbokwe) supplied bank accounts, including accounts under business names that mirrored real companies (fictitious business name filings with LA County) to trick businesses; funds moved via illicit money exchangers using naira transfers; at least $6M actually moved, plus ~$40M attempted. https://www.justice.gov/usao-cdca/pr/massive-international-fraud-and-money-laundering-conspiracy-detailed-federal-grand-jury

### 2.6 Canadian university BEC (Alaumary) [P]
- 2017: spoofed emails to a Canadian university appearing to come from a construction company asking for payment on a major building project; the university wired C$11.8M (~US$9.4M) to an account controlled by Alaumary and co-conspirators. Source: https://www.justice.gov/usao-cdca/pr/international-money-launderer-sentenced-over-11-years-federal-prison-laundering (2021-09-08). This is a textbook "fake supplier payment request" case.

### 2.7 FBI/IC3 BEC statistics [P]
- IC3 2025 Internet Crime Report (released 2026-04-06): BEC $3,046,598,558 in reported losses from 24,768 complaints (2024: $2,770,151,146 from 21,442; 2023: $2,946,830,270 from 21,489). BEC is the #2 cyber-enabled fraud type by loss after investment ($8.65B). FBI press release: https://www.fbi.gov/news/press-releases/cryptocurrency-and-ai-scams-bilk-americans-of-billions ; report PDF: https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf (I read the PDF text locally).
- 2020 affidavit quote from FBI LA: "In 2019 alone, the FBI recorded $1.7 billion in losses ... business email compromise" [P] (2020-07-03 release).
- Also 2025 report: AI-related complaints 22,364 costing "nearly $893 million"; the report says "In 2025, businesses reported losses over $30 million to BEC scams involving AI" [P].

---------------------------------------------------------------------
## 3. AI-enabled payment fraud and crypto/stablecoin redirection
---------------------------------------------------------------------

### 3.1 Arup, Hong Kong deepfake video call, Jan 2024 [P via CNN, S for police statement]
- Hong Kong police said (Feb 2024) a finance worker was duped in a video call with people he believed were the CFO and other staff, all deepfake recreations. He first suspected phishing after an email from the "UK office" requesting a secret transaction, but dropped doubts after the call. He sent HK$200 million (~US$25.6 million) in 15 transactions (RTHK). Arup confirmed on 2024-05-16 it notified Hong Kong police in January and that "fake voices and images were used"; no internal systems compromised.
- Source [P, major outlet]: https://edition.cnn.com/2024/05/16/tech/arup-deepfake-scam-loss-hong-kong-intl-hnk/index.html
- The Guardian link (found via Wikipedia, not opened): https://www.theguardian.com/technology/article/2024/may/17/uk-engineering-arup-deepfake-scam-hong-kong-ai-video
- Nuance: the trigger was a payment-instruction email plus a video call. Arup's CIO also noted attacks including "invoice fraud, phishing scams, WhatsApp voice spoofing, and deepfakes". Not a payee-detail change. Nobody was arrested as far as I found (UNVERIFIED).

### 3.2 AI-assisted invoice/executive impersonation, Microsoft-tracked campaign, Sept 2026 [S]
- KnowBe4 (2026-09-22), quoting Microsoft's security blog of 2026-09-10: AI-assisted campaign sent >1 million emails impersonating CEOs/CFOs to accounts payable to process an ACH payment of nearly $50,000, each with a customised fake ServiceNow "annual subscription" invoice paying into actor-controlled bank accounts. https://blog.knowbe4.com/ai-assisted-phishing-campaign-sent-over-a-million-personalized-emails ; Microsoft post URL (page would not render for me, so not verified directly): https://www.microsoft.com/en-us/security/blog/2026/09/10/protecting-organizations-ai-assisted-executive-impersonation-invoice-fraud/ [UNVERIFIED directly]
- No confirmed losses stated in the excerpt.

### 3.3 AI agents tricked into paying (2026) [S, vendor research; no invoice-redirection case found]
- Zscaler research reported by SecurityWeek (2026-07-06): indirect prompt injection on a fake site (SEO-poisoned "requests-secure-v2" package) told agents to pay for an "API key" (hidden div, schema markup, hardcoded crypto wallet). In Zscaler's test agent, 4 of 26 LLMs (Llama 3.3 70B, Llama 3.2 90B Vision, Gemini 3 Flash, Gemini 2.5 Pro) actually made the payment. Test environment, not real victim losses. https://www.securityweek.com/prompt-injection-attacks-trick-ai-agents-into-making-crypto-payments/
- Blockaid (2026-09-29): token-metadata prompt injection against trading agents; "Prompted Transfer - Bankr agent (~$215K, May 4)" an AI-agent wallet on Base sent ~$215,000 after being prompted publicly on social media (Bankr disclosed; SlowMist analysed); a September 14 staged demo (researcher claim). Vendor blog with sales pitch. https://blockaid.io/blog/prompt-injection-via-tokens-the-dark-side-of-agentic-commerce
- Honest finding: I found NO documented real-world case of an AI agent paying a fake or redirected supplier invoice. The nearest real cases are agent prompted to transfer (Bankr ~$215K) and lab demos. The pitch should say "the attack surface is documented and demonstrated", not "AI agents are already being scammed out of invoice payments".
- Interpol 2026-03-16 Global Financial Fraud Threat Assessment [P]: "AI-enhanced fraud is 4.5 times more profitable than traditional methods"; "'Agentic AI' systems can autonomously plan and execute complete fraud campaigns". https://www.interpol.int/en/News-and-Events/News/2026/INTERPOL-report-warns-of-increasingly-sophisticated-global-financial-fraud-threat

### 3.4 Crypto / stablecoin BEC and address poisoning
- IC3 PSA 2021-04-13 [P]: BEC involving cryptocurrency: victims send doctored wire instructions that lead to a crypto exchange; annual reported loss topped $10M in 2020. https://www.ic3.gov/PSA/2021/PSA210413. This is fiat-to-crypto conversion, not on-chain stablecoin invoicing.
- IOFM (search snippet only, 2025-07-29): "BEC ... cryptocurrency payments resulting in increased losses from $4.8 million in 2023 to $63 million in 2024" [S/UNVERIFIED: I did not open it or find it in the IC3 2025 report; do not quote].
- Trustpair (2026-09-03, snippet only): "A fraudster impersonating a supplier sends a 'new wallet address' for future invoices, mirroring the classic bank detail change scam" [S, opinion, not a case].
- **Address poisoning, May 2024, $68M WBTC [S]:** victim sent 1,155 WBTC (~$68M) to a lookalike address (first/last characters matched) after the attacker planted it via a 0-value/dust transaction. Halborn write-up 2024-05-08 (opened): https://www.halborn.com/blog/post/massive-68-million-address-poisoning-hack-underscores-ongoing-cyber-threat. **The attacker returned nearly all the funds on about 9-10 May 2024 after on-chain negotiation** (The Block 2024-05-11, TradingView 2024-05-10, snippets only; Chainalysis says the victim "nearly lost" it). So: "nearly lost $68M", not "lost $68M". Chainalysis: https://www.chainalysis.com/blog/address-poisoning-scam/ (2024-10-23; snippet says >82,000 linked addresses).
- **Address poisoning, Dec 2025, $50M USDT [S]:** Yahoo Finance/CoinDesk (opened, 2025-12-20): victim sent a $50 test transaction, attacker created a lookalike address and sent dust, victim copied it from history and sent $49,999,950 USDT; funds swapped to ETH and touched Tornado Cash; victim posted an on-chain demand offering a $1M bounty. Blockaid (opened, 2026-03-09) says the victim sent the money 26 minutes after the test. Recovery outcome: UNVERIFIED. https://finance.yahoo.com/news/crypto-user-loses-50-million-174321722.html ; https://blockaid.io/blog/address-poisoning-the-growing-threat-draining-millions-from-crypto-users
- Blockaid (2026-03-09) data: since Jan 2025 flagged >65.4M poisoning transactions; ~316,000 confirmed successful attacks (roughly 1 in 200); 30 Jan 2026 a holder lost 4,556 ETH (~$12.4M) after two months of dusting. Vendor stats, [S].
- Relevance: these are "wrong address, chosen by the payer from an untrusted source" cases, the same failure mode as "we changed our wallet details". They are not supplier impersonation.

### 3.5 Real-money supplier-impersonation cases from Interpol (great for Asia framing) [P]
- **Singapore commodity firm, July 2024, US$42.3M [P]:** On 15 Jul 2024 the firm received an email from a "supplier" asking that a pending payment go to a new bank account in Timor-Leste; the email came from an account "spelled slightly different to the supplier's official email address". Firm transferred USD 42.3M on 19 Jul; discovered 23 Jul when the real supplier said it hadn't been paid; via Interpol I-GRIP, Timor-Leste withheld >$39M by 24-25 Jul, 7 arrests, >$2M more recovered. Interpol news 2024-08-06. https://www.interpol.int/en/News-and-Events/News/2024/Police-recover-over-USD-40-million-from-international-email-scam
- **Singapore/Oman, 2026 [P]:** I-GRIP blocked a US$6.6M transfer linked to BEC where a Singapore commodity trading firm was targeted by criminals impersonating a supplier. Interpol 2026-07-09 (First Light 2026): https://www.interpol.int/en/News-and-Events/News/2026/Over-5-800-arrests-USD-293-million-intercepted-in-global-fraud-bust
- **Thailand, HAECHI VI (2025) [P]:** Royal Thai Police seized USD 6.6M, largest single-case recovery in Thailand, BEC by a gang of Thai and West African nationals that deceived a major Japanese corporation into paying a fictitious business partner in Bangkok. Also Korea: KRW 6.6bn (US$3.91M) sent to a Dubai account after a Korean steel company noticed forged shipping documents; recovered in full via I-GRIP. Interpol 2025-09-24: https://www.interpol.int/en/News-and-Events/News/2025/USD-439-million-recovered-in-global-financial-crime-operation

---------------------------------------------------------------------
## 4. Asia: how common is payment-redirection/BEC?
---------------------------------------------------------------------
Honest summary: Direct BEC statistics for Indonesia, mainland China, Hong Kong and Taiwan are thin or not broken out. Police annual stats mostly cover investment fraud, e-shopping, phone deception and phishing. The strongest Asian evidence is (a) individual BEC cases in Singapore/Thailand/Korea/Japan found in Interpol releases, (b) Hong Kong and Indonesia appearing as receiving-account (mule) jurisdictions, and (c) the Arup deepfake case. Do not claim BEC is "the top fraud type in Asia".

### 4.1 Hong Kong [P]
- HK Police/ADCC 2025 statistics: 43,212 deception cases (-2.9% on 2024), losses about HK$8.1bn (down from ~HK$9.2bn). Biggest categories: e-shopping (12,505 cases), online investment fraud (5,135 cases, HK$3.58bn, 44.1% of losses), online employment (4,095), telephone deception (8,621), phishing 1,093. BEC is NOT reported as a separate category on the page I read. Source: https://www.adcc.gov.hk/en-hk/statistic.html . I could not find a Hong Kong police BEC-specific annual number. UNVERIFIED for any BEC-per-year figure.
- Hong Kong as a destination for redirected BEC funds: Canadian Anti-Fraud Centre 2025-07-24: a Vancouver-area law firm was tricked by spear phishing into wiring funds to a fraudulent account in Hong Kong; a Hong Kong bank alerted ADCC; CAD 2.3M recovered in full. https://antifraudcentre-centreantifraude.ca/news-nouvelles/2025/2025-07-24-eng.htm [P]. Also IC3 2025 report (Hong Kong mule account for a $1M BEC/overpayment scheme, FBI RAT case) [P], Rimasauskas funds reached Hong Kong [P], Ubiquiti's loss was from its Hong Kong subsidiary [P], and Interpol mentions a Spanish victim sending funds to Hong Kong ($331,000 intercepted, 2024) [P].
- Arup (HK$200M, deepfake): see 3.1.

### 4.2 Indonesia [P for one case]
- Indonesian National Police (INP) press release 2026-08-19: "Police Cracks Down BEC Scam Operation with Victims from USA". Case uncovered with the FBI and PPATK. Method: perpetrator hacked a US buyer's email (IQ Power Tools), learned about a hardware payment to a China-based seller (Duro Machinery), then posed as the seller with an official-looking email and got the buyer to pay into an Indonesian BCA account of a shell company (PT Aksesoris Andalan Bersama). Victim loss US$350,325; US$285,859 still frozen in the account. Two suspects: an Indonesian (56) and a Chinese national (46) charged with electronic document manipulation, fraud, money laundering; a third Chinese national on the wanted list. https://inp.polri.go.id/artikel/police-cracks-down-bec-scam-operation-with-victims-from-usa [P]. (Kompas headline 2026-08-19: two arrested for hijacking business emails, losses Rp 5.6bn; only a paragraph rendered: https://www.kompas.id/artikel/criminal-investigation-unit-arrests-two-business-email-hijackers-losses-reach-rp-56-billion [S])
- Indonesia here is the money-mule destination, with the victims abroad. It is not evidence that Indonesian businesses are commonly BEC victims.
- Interpol lists Indonesia as a participant in Jackal III, Jackal IV, HAECHI VI and First Light 2026 [P]. Also Interpol 2024: Italian company lost US$3.4M (2020) for non-existent medical equipment "in Indonesia", intercepted via I-GRIP [P].
- I found no police statistics on BEC victims inside Indonesia. UNVERIFIED.

### 4.3 Mainland China / Taiwan
- Interpol First Light 2026 is funded by China's Ministry of Public Security; results mention Macao police stopping a US$372,000 impersonation-of-officials scam (not BEC) [P]. No BEC statistics for mainland China found.
- Taiwan: Rimasauskas impersonated a Taiwan-based hardware maker (Quanta) per press [S]; DOJ says only "Asian-based computer hardware manufacturer". A Google snippet of a Taiwan News Facebook post says the Criminal Investigation Bureau reported total phishing-related losses of NT$239.5 billion and that "business email fraud and ransomware" also cause heavy losses [S, snippet only, UNVERIFIED]. No primary Taiwan BEC number found.

### 4.4 Interpol HAECHI [P]
- HAECHI VI (Apr-Aug 2025, 40 countries): USD 439M recovered (USD 342M fiat + USD 97M assets), >68,000 bank accounts blocked, ~400 crypto wallets frozen; BEC is one of seven crime types targeted (voice phishing, romance, sextortion, investment fraud, illegal-gambling laundering, BEC, e-commerce fraud). https://www.interpol.int/en/News-and-Events/News/2025/USD-439-million-recovered-in-global-financial-crime-operation [P]. BEC-only totals are not broken out.
- First Light 2026 (15 Jan-30 Apr 2026, 97 countries): 5,811 arrests, USD 293M intercepted, >142,000 victims identified, 31,014 accounts blocked; BEC listed among social engineering scam types; Interpol's I-GRIP stop-payment mechanism cited for BEC cases. [P] (link in 3.5).
- Interpol Jackal/HAECHI results are mixed scam types, mostly romance/investment/impersonation, and are weak evidence of BEC prevalence specifically.

---------------------------------------------------------------------
## Best 5 cases for a 2-minute pitch video
---------------------------------------------------------------------
1. Singapore commodity firm, Jul 2024: one email from a lookalike "supplier" address asked to pay a new Timor-Leste account; US$42.3M wired on 19 Jul, discovered four days later; Interpol's stop-payment recovered >$39M. [P] https://www.interpol.int/en/News-and-Events/News/2024/Police-recover-over-USD-40-million-from-international-email-scam
2. Rimasauskas, 2013-2015: fake "Company-1" invoices and a lookalike Latvian company redirected over $120M from two US tech giants; 5 years in prison. [P] https://www.justice.gov/usao-sdny/pr/lithuanian-man-sentenced-5-years-prison-theft-over-120-million-fraudulent-business
3. Arup Hong Kong, Jan 2024: a finance worker paid HK$200M (~US$25.6M) in 15 transfers after a deepfake video call with a fake CFO. [P] https://edition.cnn.com/2024/05/16/tech/arup-deepfake-scam-loss-hong-kong-intl-hnk/index.html
4. Hushpuppi network: a New York law firm's paralegal wired $922,857 of a client's refinancing money to an account the criminals controlled; Abbas got 135 months and the laundering ring ran on accounts that "could handle millions and not block". [P] https://www.justice.gov/usao-cdca/pr/nigerian-man-sentenced-over-11-years-federal-prison-conspiring-launder-tens-millions
5. FBI 2025 IC3 data: BEC cost US$3.05B from 24,768 complaints in 2025 (2024: US$2.77B), second only to investment fraud among cyber-enabled fraud types. [P] https://www.fbi.gov/news/press-releases/cryptocurrency-and-ai-scams-bilk-americans-of-billions (figures in the report PDF https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf)
Honourable mentions: address-poisoning $50M USDT (Dec 2025, [S]) for the stablecoin angle, framed as "wrong address chosen from untrusted source"; Indonesia BCA-account case (Aug 2026, [P]) for the Asian mule angle; Zscaler agent test ([S]) for the AI-agent angle, framed as research.

---------------------------------------------------------------------
## Do not say
---------------------------------------------------------------------
- "Hushpuppi stole $300M / $435M / $1B": DOJ's plea totals about $24.2M in admitted actual/intended loss; $300M is prosecutors' figure for intended laundering volume over 18 months, mostly not realised; restitution ordered is only $1,732,841.
- "Hushpuppi stole $124M from a Premier League club": the GBP 100M (~$124M) was a complaint-stage allegation of an attempt; the plea covers ~$7.74M for two UK companies; DOJ never names the club.
- "Hushpuppi hacked emails himself" or "Hushpuppi's Qatar scheme was BEC": he pleaded to money-laundering conspiracy; Qatar was a fake-loan advance-fee fraud; Malta was a bank SWIFT hack by North Korean hackers, not invoice fraud.
- "Hushpuppi was extradited from Dubai": DOJ says expelled by the UAE (arrested June 2020, in the US 2 July 2020).
- "Google and Facebook lost $100M": DOJ names no victims, says >$120M was wired, ordered restitution of ~$26.5M; reports say most was recovered. Naming Google/Facebook/Quanta relies on press, not DOJ.
- "Okeke stole $11M from a Caterpillar dealer": DOJ says Unatrac, Caterpillar's export sales office; the loss was "nearly $11M" and the entry route was credential phishing plus fake invoices.
- "Toyota Boshoku lost $37M because a supplier changed its bank details": the company statement says only "fraudulent payment directions", about 4 billion yen maximum, no method; the $37M and BEC labels are media inference.
- "Ubiquiti was tricked by changed invoice details": the SEC filing says employee impersonation and fraudulent requests; $46.7M, of which $8.1M was recovered and $6.8M frozen at the time.
- "Arup was a supplier-invoice scam" or "Arup lost $25M to deepfakes" without "HK$200 million, 15 transfers, after a video call"; Arup also has not been shown to have prosecuted anyone.
- "$68M WBTC address-poisoning theft" without adding that the attacker returned nearly all the funds within about a week; "$50M USDT" recovery outcome is unverified.
- "AI agents are already being tricked into paying fake invoices": no documented real case found. Documented: lab tests (Zscaler 4 of 26 models paid), a ~$215K Bankr agent transfer prompted on social media (vendor-reported), and Interpol/IC3 warnings.
- "BEC is the top scam in Asia / Indonesia / Hong Kong / Taiwan": police statistics I found are dominated by investment, e-shopping and phone scams; BEC is not broken out. Asian BEC evidence is case-based (Singapore $42.3M, Thailand $6.6M, Korea $3.9M, Indonesia $350K mule case, Arup).
- "The FBI says BEC has cost $55B": I did not verify a cumulative figure in this session; use IC3 2025 = $3.05B for the year. Tripwire's "$26.2B, May 2018-June 2019" is a 2019 FBI PSA figure repeated by a guest blog, not opened at the source [S].
- "Black Axe is a BEC gang": Interpol calls it a broad organised-crime syndicate (cyber fraud, trafficking, drugs, violence).
- "West African/Nigerian fraudsters" as blanket language: DOJ cases include Lithuanian (Rimasauskas), Canadian (Alaumary), Chinese/Indonesian (Jakarta case) and Thai/West African gangs. For a Nigerian founder's credibility, cite Nigerian police cooperation (Falcon II, EFCC in reWired) rather than generalising.
