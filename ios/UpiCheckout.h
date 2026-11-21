#import <Foundation/Foundation.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import <RNUpiCheckoutSpec/RNUpiCheckoutSpec.h>

@interface UpiCheckout : NSObject <NativeUpiCheckoutSpec>
#else
#import <React/RCTBridgeModule.h>

@interface UpiCheckout : NSObject <RCTBridgeModule>
#endif

@end
