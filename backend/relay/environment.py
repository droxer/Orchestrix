import sys

from .core import environment as _module

sys.modules[__name__] = _module
