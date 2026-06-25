import sys

from .services import bridge as _module

sys.modules[__name__] = _module
