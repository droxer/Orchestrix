import sys

from .persistence import stores as _module

sys.modules[__name__] = _module
