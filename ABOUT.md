# What is Canary?

**Canary tells you where a neighborhood is heading, not just what it is like today.**

When you are deciding where to live, everything you can look up describes the
present: crime rates, walk scores, photos, prices. But nobody moves into the present.
When you sign a lease you are committing to the next few years of a street's life,
and what you actually want to know is where that street is going.

- Is this area getting better or worse?
- Are businesses opening here, or quietly disappearing?
- Is anything about to be built next to my window?

Nobody answers those questions. Not the listing sites, not the review apps, and, as
we found out when we tested them, not the AI assistants either. More on that below.

## How Canary answers them

Cities publish enormous amounts of public records. Every building permit, every
registered business opening and closing, every police report, every noise complaint,
every eviction notice becomes a row in some public dataset. Millions of rows, updated
constantly, and almost impossible for a person to read.

Canary reads them. We collect these records continuously, clean them up, and turn
them into an honest picture of how every neighborhood is changing. On the map, that
looks like two things. The neighborhood colors show whether an area's activity is
rising or falling: new businesses, construction, safety reports, complaints, each
measured over the last year against the year before. And for any address, we can show
what is coming: construction that is already approved nearby, how big it will be, how
many homes it adds, with the actual permit number attached.

## Why you can trust it

Every number traces back to a public record you can check for yourself, whether that
is a permit number, a business registration, or a dated city report. We never publish
a score that says a neighborhood is "good" or "bad." We show you what is happening,
with the receipts, and you decide what it means for you.

We are also honest about what the data cannot say, because public records mislead in
known ways. Three real examples from building this:

- Police reports measure police activity as much as crime. In the Tenderloin, reports
  went up 11%, but that was a drug enforcement crackdown. Crimes reported by actual
  victims went down 8% over the same period. We show those separately, so a
  crackdown never gets mistaken for a crime wave.
- The city's count of 311 noise complaints jumped 62% in a year. Most of that turned
  out to be a change in the city's phone app, not louder streets. We publish the
  corrected version.
- When businesses close, the paperwork often lags months behind reality. We say so
  rather than pretending the number is sharper than it is.

## What we found about AI assistants

We tested the five newest AI models, including ones with live web search, on 136
checkable questions about San Francisco neighborhoods, each answer verified against
the city's own records before any model ran. They scored 25-47%, and unlike older
models they rarely admit uncertainty anymore. One was confidently wrong on two of
every three answers. When we asked which neighborhood was rising fastest, the five
models gave four different confident answers, and all of them were wrong.

The reason is simple: these answers were never written down anywhere on the
internet, so no AI can find them, no matter how smart it gets. They even failed on
questions about past years they were trained on, whenever the answer had never been
published. Someone has to compute these numbers from the raw records first. When we
gave the same models Canary's data, they scored 95-99%. The full study is in the
**Research** tab.

## Who this is for

**People choosing where to live** use Canary free. This kind of information used to
be an institutional privilege, sold to developers and investment funds. We think the
family signing a lease deserves it too.

**AI apps and companies** can get the same data machine-readable, so their answers
about places stop being wrong.

*Today: San Francisco. The engine is built to add cities without starting over.*
