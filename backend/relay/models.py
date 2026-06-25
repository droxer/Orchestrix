import sys

from .core import models as _module

sys.modules[__name__] = _module
