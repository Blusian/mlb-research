from __future__ import annotations

import unittest

from app.utils.math_utils import parse_float


class MathUtilsTests(unittest.TestCase):
    def test_parse_float_uses_fallback_for_nan_and_infinity(self) -> None:
        self.assertEqual(parse_float("nan", 8.0), 8.0)
        self.assertEqual(parse_float(float("nan"), 7.0), 7.0)
        self.assertEqual(parse_float("inf", 6.0), 6.0)
        self.assertEqual(parse_float(float("-inf"), 5.0), 5.0)


if __name__ == "__main__":
    unittest.main()
