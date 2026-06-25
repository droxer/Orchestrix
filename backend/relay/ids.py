import sys

from .core import ids as _module

sys.modules[__name__] = _module
