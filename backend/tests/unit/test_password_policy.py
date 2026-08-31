"""The password policy: length, blocklist, context words, degenerate shapes."""

from __future__ import annotations

import pytest

from relay.security.passwords import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    PasswordRejected,
    validate_password,
)

GOOD = "kestrel-vault-7719"


def test_accepts_a_long_unrelated_passphrase() -> None:
    assert validate_password(GOOD, identifiers=("alice", "Alice Chen")) == GOOD
    # No composition rules: an all-lowercase passphrase is fine, which is the
    # point of following NIST rather than demanding a symbol.
    assert validate_password("correct horse battery staple")


@pytest.mark.parametrize("password", ["", "short", "1234567"])
def test_rejects_too_short(password: str) -> None:
    with pytest.raises(PasswordRejected):
        validate_password(password)


def test_rejects_too_long() -> None:
    at_the_ceiling = ("harbor-quartz-" * 40)[:MAX_PASSWORD_LENGTH]
    assert validate_password(at_the_ceiling)
    with pytest.raises(PasswordRejected, match="at most"):
        validate_password(at_the_ceiling + "x")


@pytest.mark.parametrize(
    "password",
    [
        "password",
        "PASSWORD",
        # A trailing digit or bang is the standard way a blocked password is
        # smuggled past a naive list.
        "password1",
        "password!",
        "letmein123",
        # Leet substitutions are the same secret.
        "p@ssw0rd",
        "s3cr3t123",
        # Named for this product, so an obvious first guess here.
        "relay123",
    ],
)
def test_rejects_common_passwords(password: str) -> None:
    with pytest.raises(PasswordRejected, match="commonly guessed"):
        validate_password(password)


@pytest.mark.parametrize(
    "password",
    ["alice-in-wonderland", "AlicePass123!", "chen-was-here-2026", "alice@corp.io"],
)
def test_rejects_the_accounts_own_names(password: str) -> None:
    identifiers = ("alice", "Alice Chen", "alice@example.com")
    with pytest.raises(PasswordRejected, match="username, handle, name, or email"):
        validate_password(password, identifiers=identifiers)


def test_short_identifiers_do_not_reject_half_the_dictionary() -> None:
    # A two-letter handle inside a passphrase is not a meaningful guess, and
    # refusing it would reject far more than it protects.
    assert validate_password("something-ordinary-88", identifiers=("jo", "id"))


def test_ignores_the_email_domain_everyone_shares() -> None:
    assert validate_password(
        "example-of-a-fine-one", identifiers=("zoe", "zoe@example.com")
    )


@pytest.mark.parametrize(
    "password", ["aaaaaaaa", "abcdefghij", "jihgfedcba", "qwertyuiop", "0123456789"]
)
def test_rejects_degenerate_shapes(password: str) -> None:
    with pytest.raises(PasswordRejected):
        validate_password(password)


def test_a_short_run_inside_a_real_password_is_fine() -> None:
    # "abc" is a run, but not one long enough to be the whole idea.
    assert validate_password("harbor-abc-tumbler")


def test_bounds_are_the_numbers_the_web_form_mirrors() -> None:
    assert (MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH) == (8, 256)
