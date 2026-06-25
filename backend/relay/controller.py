import sys

from .services import controller as _module

sys.modules[__name__] = _module
