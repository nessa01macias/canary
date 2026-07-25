"""Crime category classification: what does a count of incident reports actually measure?

Police incident data mixes three different signals (VALIDATION.md, Tenderloin finding):

  victim_reported     a member of the public reports being victimized; counts track
                      crime as experienced (subject to reporting propensity)
  enforcement_driven  counts track POLICE PROACTIVITY (stops, operations, sweeps) --
                      a surge means a crackdown, not necessarily more crime
  everything else     administrative/ambiguous (lost property, case closures,
                      suspicious-occ calls) -- excluded from both trend metrics

Any user-facing crime trend must use victim_reported; enforcement_driven is its own
(interesting!) signal about policing intensity. The unsplit total stays available as
crime_incidents for continuity.

Categories from the 2018-present dataset (incl. its typo variants, e.g.
'Weapons Offence', 'Motor Vehicle Theft?'). Unlisted categories fall into neither
bucket (counted only in crime_incidents).
"""

VICTIM_REPORTED = frozenset(
    {
        "Larceny Theft",
        "Assault",
        "Burglary",
        "Motor Vehicle Theft",
        "Motor Vehicle Theft?",
        "Robbery",
        "Malicious Mischief",
        "Vandalism",
        "Fraud",
        "Arson",
        "Embezzlement",
        "Forgery And Counterfeiting",
        "Sex Offense",
        "Rape",
        "Homicide",
        "Offences Against The Family And Children",
    }
)

ENFORCEMENT_DRIVEN = frozenset(
    {
        "Drug Offense",
        "Drug Violation",
        "Warrant",
        "Prostitution",
        "Weapons Offense",
        "Weapons Carrying Etc",
        "Weapons Offence",
        "Stolen Property",  # possession cases: discovered via stops/searches
        "Traffic Violation Arrest",
        "Disorderly Conduct",
        "Civil Sidewalks",  # sit-lie enforcement
        "Liquor Laws",
        "Gambling",
        "Human Trafficking (A), Commercial Sex Acts",
        "Human Trafficking (B), Involuntary Servitude",
        "Human Trafficking, Commercial Sex Acts",  # surfaced by operations, not 911 calls
    }
)


def sql_in(categories: frozenset[str]) -> str:
    """The set as a SQL IN-list literal."""
    return "(" + ", ".join("'" + c.replace("'", "''") + "'" for c in sorted(categories)) + ")"
